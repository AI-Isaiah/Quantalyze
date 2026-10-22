-- Test: public.replace_allocator_equity_snapshots_window (Phase 167.2.1.1.2
-- ACCTREBUILD, plan 03). Guards migration
-- 20261028120000_replace_allocator_equity_snapshots_window.sql.
--
-- Background
-- ----------
-- A Bybit-backed account's stored allocation history is being rebuilt, and the
-- rebuild can only reach as far back as the venue lets it. The function replaces
-- ONLY the rebuilt window, refuses (inside its own transaction) when that would
-- drop a stored day the rebuild did not reproduce, and records the seam. The
-- Python side of this is a hand-written fake of the same rules, so a green Python
-- test proves only the mapping (RESEARCH pitfall 3). THIS file is where the SQL
-- semantics are proven able to fail:
--   D-01  rows with asof >= p_window_start are replaced; older rows are untouched.
--   D-02  a stored in-window day missing from the payload raises P0001
--         history_days_unreproduced and leaves everything as it was (SC-4).
--   D-03  the snapshot_rebuild_boundary row is written iff an older row is kept,
--         names the first rebuilt day (the real seam), keeps the earliest seam
--         while older kept rows still precede it, and is cleared wherever all of an
--         allocator's snapshots are wiped or fully replaced.
--   AR-1  the definer write to the FORCE-RLS allocator_equity_derived succeeds on
--         the service-role call path.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each
-- twin's FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend
-- on arms listed before it, and every arm seeds its own allocator(s) so no arm's
-- rows can feed another arm's DELETE):
--   1  another allocator's rows, boundary row and derived rows are untouched.
--   2  the window is replaced, the window-start day included (asof >= start).
--   3  rows older than the window are byte-identical afterwards (D-01).
--   4  an unreproduced stored in-window day is refused with P0001
--      history_days_unreproduced and nothing changes (D-02, SC-4); 4-LATE pins
--      the late-refresh ordering: a row that arrives after the payload was built
--      is refused, never deleted unseen.
--   5  the boundary row is written iff an older row is kept, holds exactly
--      {"boundary_date": "2026-03-10"} for a payload that starts on the window
--      start, and is deleted when no older row is kept (D-03).
--   6  the call works on the service-role path and the arm records which rule
--      admitted the definer write to the FORCE-RLS table (AR-1, RESEARCH A2).
--   7  the owner reads the boundary row and no one else does (D-03 reader rule).
--   8  every malformed input raises 22023 with its token and writes nothing.
--   9  anon and authenticated cannot EXECUTE, service_role can; one overload;
--      SECURITY DEFINER; search_path and lock_timeout pinned; the lock key text.
--   10 the CL9 pre_terminus_balance_unknown flag persists true / false / omitted
--      as false.
--   11 the WR-05 depth rule: history_depth_months only on exchange_primary rows.
--   12 replace_allocator_equity_snapshots (the whole-history replace) clears the
--      allocator's boundary row and no one else's (review WR-01).
--   13 the last-key cascade of delete_allocator_api_key clears the boundary row, and
--      a cascade that keeps the snapshots keeps it (review WR-01).
--   14 the boundary date is the first rebuilt day, min(asof) of the inserted rows,
--      not the window start (review WR-01).
--   15 a later window call keeps the earliest seam while older kept rows still
--      precede it, and moves it when none does (review WR-01).
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the function is an EXCEPTION, never a
-- skip. Merging supabase/migrations/** applies to PRODUCTION with no human stop,
-- so nothing in the merge path would make a missing object appear. Do not add a
-- presence skip.
--
-- SENTINEL. The final `ALL 15 ARMS EXECUTED (1,...,15)` notice at the foot of
-- this file, before ROLLBACK, joins ci.yml's `sql-tests` sentinel census. That
-- census is moved by plan 05 of this phase, not here.
--
-- ⚠️ WHAT THE ARMS RUN AS. Every arm except 6 and 7 calls the function as the
-- session user. SECURITY DEFINER makes the caller matter only for EXECUTE and for
-- auth.role(), and the EXECUTE grant is pinned by arm 9 from the catalogue. Arm 6
-- is the A2 proof: it calls under SET LOCAL ROLE service_role with
-- request.jwt.claims role service_role, the one real caller, and prints the
-- function owner's rolsuper and rolbypassrls, so the lane log records which rule
-- admitted the definer write to FORCE-RLS allocator_equity_derived. On the
-- pg-lane the owner is a superuser, which proves nothing about PROD; the
-- local-stack lane (the Supabase image, whose roles mirror PROD's) is the lane
-- where A2 is proven, and CI's sql-tests job runs this gate there. Arm 7 reads as
-- `authenticated` to prove the owner-only SELECT policy on the boundary row.
--
-- Every identity carries a digit (`4-LATE`, never a bare letter). The runner's
-- `sectionOfIdentity` collapses a trailing `-SUFFIX` into its parent only when a
-- digit precedes it, so `4-LATE` is a sub-arm covered by arm 4's twin.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure, no psql meta-commands, no UPDATE statement. The whole test rolls back.
-- Seed data is synthetic: generated uuids, @invalid.local emails and invented
-- 2026 dates; no message names a uuid.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm below carries a prose `RED-UNDER:` and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a throwaway
-- pg-lane cluster to PROVE the arm reds on its own, then restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. Every edit twin targets the migration that
-- LAST defines what it mutates, which is the new one, 20261028120000: it defines
-- a function BODY (which its catalogue-only verify block never runs) and the
-- verify block checks none of the lines edited here, so the mutated migration
-- applies clean and the gate, not the apply, is what speaks. The grant and policy
-- twins are post-apply `sql` steps, because an edit of the GRANT or the policy
-- would abort an apply that asserts them and score no identity.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql"]}

BEGIN;

-- Seeds one allocator (an auth.users row; allocator_equity_snapshots and
-- allocator_equity_derived both reference it). pg_temp functions live and die
-- with this transaction and carry no arm.
CREATE FUNCTION pg_temp.wnd_user() RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'wnd-' || v_user::text || '@invalid.local', now(), now());
  RETURN v_user;
END
$f$;

-- Seeds one snapshot row. reconstructed_at is explicit and distinct from now(),
-- because now() is constant inside one transaction and a column that defaulted to
-- it would compare equal before and after any rewrite.
CREATE FUNCTION pg_temp.wnd_snap(
  p_alloc uuid, p_asof date, p_value numeric,
  p_source text DEFAULT 'exchange_primary', p_depth integer DEFAULT NULL,
  p_flag boolean DEFAULT false, p_breakdown jsonb DEFAULT '{"USDT": 1}'::jsonb,
  p_at timestamptz DEFAULT TIMESTAMPTZ '2026-02-01 03:04:05+00')
RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.allocator_equity_snapshots
    (allocator_id, asof, value_usd, breakdown, reconstructed_at, source,
     history_depth_months, pre_terminus_balance_unknown)
  VALUES (p_alloc, p_asof, p_value, p_breakdown, p_at, p_source, p_depth, p_flag);
END
$f$;

-- Builds a payload carrying the given days at the given value.
CREATE FUNCTION pg_temp.wnd_payload(p_days date[], p_value numeric) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object(
           'asof', to_char(d, 'YYYY-MM-DD'),
           'value_usd', p_value,
           'breakdown', jsonb_build_object('USDT', p_value),
           'source', 'exchange_primary',
           'pre_terminus_balance_unknown', false) ORDER BY d)
    FROM unnest(p_days) AS d
$f$;

-- Seeds one api_keys row (and the profile it hangs off) for an allocator and
-- returns the key id, for the delete_allocator_api_key arm.
CREATE FUNCTION pg_temp.wnd_key(p_alloc uuid) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_key uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (p_alloc, 'wnd', 'allocator')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, p_alloc, 'binance', 'wnd', 'x');
  RETURN v_key;
END
$f$;

-- Whole-row images of one allocator's snapshot rows and derived rows, so a
-- before/after compare covers EVERY column (reconstructed_at and
-- history_depth_months included).
CREATE FUNCTION pg_temp.wnd_snaps(p_alloc uuid) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.asof), '[]'::jsonb)
    FROM public.allocator_equity_snapshots s WHERE s.allocator_id = p_alloc
$f$;

CREATE FUNCTION pg_temp.wnd_derived(p_alloc uuid) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.kind), '[]'::jsonb)
    FROM public.allocator_equity_derived d WHERE d.allocator_id = p_alloc
$f$;

DO $$
DECLARE
  v_ws     CONSTANT date := DATE '2026-03-10';
  v_a      uuid;
  v_b      uuid;
  v_c      uuid;
  v_d      uuid;
  v_e      uuid;
  v_f      uuid;
  v_g      uuid;
  v_h      uuid;
  v_i      uuid;
  v_j      uuid;
  v_k      uuid;
  v_m      uuid;
  v_n1     uuid;
  v_n2     uuid;
  v_o1     uuid;
  v_o2     uuid;
  v_p1     uuid;
  v_p2     uuid;
  v_p3     uuid;
  v_pk1    uuid;
  v_pk2    uuid;
  v_pk3    uuid;
  v_pk4    uuid;
  v_q      uuid;
  v_r      uuid;
  v_s      uuid;
  v_state  text;
  v_msg    text;
  v_ret    integer;
  v_n      integer;
  v_snaps0 jsonb;
  v_snaps1 jsonb;
  v_der0   jsonb;
  v_der1   jsonb;
  v_old0   jsonb;
  v_old1   jsonb;
  v_pay    jsonb;
  v_flag1  boolean;
  v_flag2  boolean;
  v_flag3  boolean;
  v_dep1   integer;
  v_dep2   integer;
  v_dep3   integer;
  v_super  boolean;
  v_bypass boolean;
  v_oid    oid := to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)');
  v_secdef boolean;
  v_cfg    text[];
  v_src    text;
  v_case   RECORD;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) does not exist - this gate has nothing to test and must not skip';
  END IF;

  -- ===== ARM 1 - another allocator's rows are not touched ===================
  -- A is rebuilt over 2026-03-11..12 (no row on the window start itself: that edge
  -- belongs to arm 2). B holds an older row, in-window rows on days
  -- A's payload does not carry (2026-03-13..14), a boundary row and an equity_curve
  -- row. Every B row must be identical afterwards.
  -- RED-UNDER: drop `s.allocator_id = p_allocator_id` from the DELETE in
  --            20261028120000. The window purge then deletes every allocator's
  --            in-window rows. The D-02 check would still refuse in this seed
  --            (B's days are not in A's payload), which is why the arm catches the
  --            defect through the call raising as well as through changed rows.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"WHERE s.allocator_id = p_allocator_id\n       AND s.asof >= p_window_start","replace":"WHERE s.asof >= p_window_start","occurrences":1}]}
  v_a := pg_temp.wnd_user();
  v_b := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_a, DATE '2026-03-11', 10);
  PERFORM pg_temp.wnd_snap(v_a, DATE '2026-03-12', 10);
  PERFORM pg_temp.wnd_snap(v_b, DATE '2026-03-01', 7);
  PERFORM pg_temp.wnd_snap(v_b, DATE '2026-03-13', 20);
  PERFORM pg_temp.wnd_snap(v_b, DATE '2026-03-14', 21);
  INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload, computed_at)
  VALUES (v_b, 'snapshot_rebuild_boundary', '{"boundary_date": "2026-02-01"}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00'),
         (v_b, 'equity_curve', '{"curve": []}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00');
  v_snaps0 := pg_temp.wnd_snaps(v_b);
  v_der0 := pg_temp.wnd_derived(v_b);
  v_state := NULL; v_msg := NULL; v_ret := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_a, pg_temp.wnd_payload(ARRAY[DATE '2026-03-11', DATE '2026-03-12'], 11), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): rebuilding allocator A raised % (%) - it must touch only A''s own rows', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1): the call returned %, expected 2 inserted rows', COALESCE(v_ret::text, 'NULL');
  END IF;
  v_snaps1 := pg_temp.wnd_snaps(v_b);
  v_der1 := pg_temp.wnd_derived(v_b);
  IF v_snaps1 IS DISTINCT FROM v_snaps0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): another allocator''s snapshot rows changed (% rows before, % after)', jsonb_array_length(v_snaps0), jsonb_array_length(v_snaps1);
  END IF;
  IF v_der1 IS DISTINCT FROM v_der0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): another allocator''s derived rows changed';
  END IF;

  -- ===== ARM 2 - the window is replaced, the window-start day included ======
  -- C holds in-window rows only, one exactly ON the window start. The payload
  -- carries every stored day at a new value plus one new day. Every day must carry
  -- its payload value and the return must equal the payload length.
  -- RED-UNDER: turn `s.asof >= p_window_start` in the DELETE into
  --            `s.asof > p_window_start` in 20261028120000. The window-start day
  --            is then NOT purged, the payload's row for it is skipped by
  --            ON CONFLICT DO NOTHING, and the day keeps its stale value. Only an
  --            arm with a row exactly ON the window start can see it.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"AND s.asof >= p_window_start","replace":"AND s.asof > p_window_start","occurrences":1}]}
  v_c := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_c, DATE '2026-03-10', 1);
  PERFORM pg_temp.wnd_snap(v_c, DATE '2026-03-11', 1);
  PERFORM pg_temp.wnd_snap(v_c, DATE '2026-03-12', 1);
  v_state := NULL; v_msg := NULL; v_ret := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_c, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-11', DATE '2026-03-12', DATE '2026-03-13'], 2), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2): the call raised % (%) instead of replacing the window', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'TEST FAILED (2): the call returned %, expected 4 (the payload length)', COALESCE(v_ret::text, 'NULL');
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_snapshots WHERE allocator_id = v_c;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'TEST FAILED (2): % rows are stored for the allocator, expected exactly the 4 sent', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_snapshots
   WHERE allocator_id = v_c AND value_usd = 2;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'TEST FAILED (2): only % of the 4 days carry the payload value; the window-start day or another in-window day kept its stale value', v_n;
  END IF;

  -- ===== ARM 3 - rows older than the window are byte-identical (D-01) =======
  -- D holds two older rows with distinct breakdown, source, depth, flag and
  -- reconstructed_at, and in-window rows. After the call each older row must equal
  -- its pre-call to_jsonb, reconstructed_at included.
  -- RED-UNDER: drop `AND s.asof >= p_window_start` from the DELETE in
  --            20261028120000. The purge then takes the older days too; the D-02
  --            check refuses because the payload carries none of them, so the call
  --            raises and the rebuild would wipe nothing here, which is why the
  --            arm reports the raise as its failure: a D-01 breach is a refusal of
  --            a legitimate window rebuild.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"\n       AND s.asof >= p_window_start","replace":"","occurrences":1}]}
  v_d := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_d, DATE '2026-03-01', 5, 'coingecko_fallback', NULL, true, '{"BTC": 5}'::jsonb, TIMESTAMPTZ '2026-02-03 01:02:03+00');
  PERFORM pg_temp.wnd_snap(v_d, DATE '2026-03-05', 6, 'exchange_primary', 24, false, '{"ETH": 6}'::jsonb, TIMESTAMPTZ '2026-02-04 04:05:06+00');
  PERFORM pg_temp.wnd_snap(v_d, DATE '2026-03-10', 8);
  PERFORM pg_temp.wnd_snap(v_d, DATE '2026-03-11', 8);
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.asof) INTO v_old0
    FROM public.allocator_equity_snapshots s
   WHERE s.allocator_id = v_d AND s.asof < v_ws;
  v_state := NULL; v_msg := NULL; v_ret := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_d, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-11'], 9), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): the call raised % (%) - a window rebuild over reproduced days must not be refused, and must leave older days alone', v_state, v_msg;
  END IF;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.asof) INTO v_old1
    FROM public.allocator_equity_snapshots s
   WHERE s.allocator_id = v_d AND s.asof < v_ws;
  IF v_old1 IS DISTINCT FROM v_old0 THEN
    RAISE EXCEPTION 'TEST FAILED (3): a row older than the window changed or vanished (% rows before, % after)', COALESCE(jsonb_array_length(v_old0), 0), COALESCE(jsonb_array_length(v_old1), 0);
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_snapshots
   WHERE allocator_id = v_d AND asof >= v_ws AND value_usd = 9;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (3): % of the 2 in-window days carry the payload value', v_n;
  END IF;

  -- ===== ARM 4 - an unreproduced stored day is refused, nothing changes =====
  -- E holds in-window rows on three days and an older row, plus a derived
  -- equity_curve row and a STALE boundary row (a different date, so a boundary
  -- upsert would be visible). The payload omits 2026-03-11. Expect P0001 with the
  -- bare message history_days_unreproduced and every snapshot and derived row
  -- unchanged.
  -- RED-UNDER: turn `IF v_unreproduced > 0 THEN` into `IF false THEN` in
  --            20261028120000. The call then deletes the unreproduced day and
  --            succeeds: the silent loss of a stored day that SC-4 forbids. The
  --            migration's verify block reads the catalogue only, so the edited
  --            function applies clean.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"IF v_unreproduced > 0 THEN","replace":"IF false THEN","occurrences":1}]}
  v_e := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_e, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_e, DATE '2026-03-10', 4);
  PERFORM pg_temp.wnd_snap(v_e, DATE '2026-03-11', 4);
  PERFORM pg_temp.wnd_snap(v_e, DATE '2026-03-12', 4);
  INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload, computed_at)
  VALUES (v_e, 'snapshot_rebuild_boundary', '{"boundary_date": "2026-02-01"}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00'),
         (v_e, 'equity_curve', '{"curve": []}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00');
  v_snaps0 := pg_temp.wnd_snaps(v_e);
  v_der0 := pg_temp.wnd_derived(v_e);
  v_state := NULL; v_msg := NULL; v_ret := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_e, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-12'], 5), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM 'P0001' OR v_msg IS DISTINCT FROM 'history_days_unreproduced' THEN
    RAISE EXCEPTION 'TEST FAILED (4): a payload missing a stored in-window day was not refused with P0001 history_days_unreproduced (SQLSTATE %, message %)', COALESCE(v_state, 'none - the call SUCCEEDED'), COALESCE(v_msg, 'none');
  END IF;
  IF pg_temp.wnd_snaps(v_e) IS DISTINCT FROM v_snaps0 THEN
    RAISE EXCEPTION 'TEST FAILED (4): the refused call changed the allocator''s snapshot rows (% rows before, % after)', jsonb_array_length(v_snaps0), jsonb_array_length(pg_temp.wnd_snaps(v_e));
  END IF;
  IF pg_temp.wnd_derived(v_e) IS DISTINCT FROM v_der0 THEN
    RAISE EXCEPTION 'TEST FAILED (4): the refused call changed the allocator''s derived rows (the boundary row must not move on a refusal)';
  END IF;
  -- 4-LATE: the payload is built from what was stored, THEN the daily refresh
  -- writes one more in-window day, THEN the call runs. The check is made inside
  -- the transaction on the rows the DELETE returned, so the late day is refused
  -- and kept; a check made on an earlier read could not see it.
  v_f := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_f, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_f, DATE '2026-03-10', 4);
  PERFORM pg_temp.wnd_snap(v_f, DATE '2026-03-11', 4);
  v_pay := pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-11'], 5);
  PERFORM pg_temp.wnd_snap(v_f, DATE '2026-03-12', 4);   -- the late daily refresh
  v_snaps0 := pg_temp.wnd_snaps(v_f);
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(v_f, v_pay, 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM 'P0001' OR v_msg IS DISTINCT FROM 'history_days_unreproduced' THEN
    RAISE EXCEPTION 'TEST FAILED (4-LATE): a stored day written after the payload was built was not refused with P0001 history_days_unreproduced (SQLSTATE %, message %)', COALESCE(v_state, 'none - the call SUCCEEDED'), COALESCE(v_msg, 'none');
  END IF;
  IF pg_temp.wnd_snaps(v_f) IS DISTINCT FROM v_snaps0 THEN
    RAISE EXCEPTION 'TEST FAILED (4-LATE): the refused call changed the snapshot rows; the late day must still be there (% rows before, % after)', jsonb_array_length(v_snaps0), jsonb_array_length(pg_temp.wnd_snaps(v_f));
  END IF;

  -- ===== ARM 5 - the seam record (D-03) =====================================
  -- G keeps an older row: the boundary row must hold exactly
  -- {"boundary_date": "2026-03-10"} (the payload starts on the window start, so
  -- the first rebuilt day and the window start are the same day here; arm 14 pulls
  -- them apart and arm 15 owns what a later call does to the row); M keeps no older row and holds a stale boundary row, which must be
  -- gone afterwards while M's other derived rows stay.
  -- RED-UNDER: make the boundary condition in 20261028120000 `IF false AND
  --            EXISTS (...)`. The seam is then never recorded (the ELSE deletes
  --            it), so the kept older days and the rebuilt days meet with no
  --            disclosure of the jump, which D-03 makes the minimum honest
  --            statement. Only an arm that reads the derived table after the call
  --            can see it.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"IF EXISTS (SELECT 1\n               FROM public.allocator_equity_snapshots s","replace":"IF false AND EXISTS (SELECT 1\n               FROM public.allocator_equity_snapshots s","occurrences":1}]}
  v_g := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_g, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_g, DATE '2026-03-10', 4);
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_g, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-11'], 5), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (5): the call raised % (%) instead of recording the boundary', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_g AND kind = 'snapshot_rebuild_boundary';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (5): % snapshot_rebuild_boundary rows exist after a rebuild that kept an older day, expected exactly 1', v_n;
  END IF;
  IF (SELECT payload FROM public.allocator_equity_derived
       WHERE allocator_id = v_g AND kind = 'snapshot_rebuild_boundary')
     IS DISTINCT FROM '{"boundary_date": "2026-03-10"}'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (5): the boundary payload is %, expected exactly {"boundary_date": "2026-03-10"}',
      (SELECT payload::text FROM public.allocator_equity_derived WHERE allocator_id = v_g AND kind = 'snapshot_rebuild_boundary');
  END IF;
  -- No older row kept: a stale boundary row is deleted, other kinds survive.
  v_m := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_m, DATE '2026-03-10', 4);
  INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload)
  VALUES (v_m, 'snapshot_rebuild_boundary', '{"boundary_date": "2026-01-01"}'::jsonb),
         (v_m, 'equity_curve', '{"curve": []}'::jsonb);
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_m, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10'], 5), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (5): the no-older-row call raised % (%)', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_m AND kind = 'snapshot_rebuild_boundary';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (5): the stale boundary row survived a rebuild that kept no older day (% rows)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_m AND kind = 'equity_curve';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (5): the boundary delete took another derived kind with it (% equity_curve rows left, expected 1)', v_n;
  END IF;

  -- ===== ARM 6 - the service-role path (AR-1, RESEARCH A2) ==================
  -- H keeps an older row. The call is made as service_role with the matching JWT
  -- claim, the one real caller. Both tables must be written. The owner's
  -- rolsuper and rolbypassrls are printed, so the lane log records which rule
  -- admitted the definer write to FORCE-RLS allocator_equity_derived.
  -- RED-UNDER: revoke EXECUTE on the function from service_role after the
  --            migration has applied (a post-apply `sql` step, because the
  --            migration's verify block asserts the grant and an edit would abort
  --            the apply). The worker's call then fails with 42501 and the
  --            account cannot be rebuilt at all.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"sql","stmt":"REVOKE EXECUTE ON FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) FROM service_role"}]}
  v_h := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_h, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_h, DATE '2026-03-10', 4);
  v_state := NULL; v_msg := NULL; v_ret := NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_h, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-11'], 5), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6): the call as service_role raised % (%) - the worker could not rebuild an account', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_snapshots
   WHERE allocator_id = v_h AND asof >= v_ws AND value_usd = 5;
  IF v_ret IS DISTINCT FROM 2 OR v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (6): the service-role call returned % and left % rebuilt rows, expected 2 and 2', COALESCE(v_ret::text, 'NULL'), v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_h AND kind = 'snapshot_rebuild_boundary';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (6): the service-role call wrote % boundary rows to allocator_equity_derived, expected 1 (the definer write to the FORCE-RLS table failed or was skipped)', v_n;
  END IF;
  SELECT r.rolsuper, r.rolbypassrls INTO v_super, v_bypass
    FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.oid = v_oid;
  RAISE NOTICE 'ARM 6 (A2): function owner rolsuper=%, rolbypassrls=% - the definer write to FORCE-RLS allocator_equity_derived succeeded on the service-role path', v_super, v_bypass;

  -- ===== ARM 7 - only the owner reads the boundary row (D-03 reader rule) ===
  -- I keeps an older row, so a boundary row exists. As I exactly one boundary row
  -- is visible and none of anyone else's (arms 1, 5 and 6 left other allocators'
  -- boundary rows in this transaction); as J none of I's.
  -- RED-UNDER: widen the owner SELECT policy to `USING (true)` after the
  --            migration has applied (a post-apply `sql` step: 20260717233529
  --            asserts the policy and an edit would abort the apply). Every
  --            authenticated user then reads every allocator's seam record.
  -- RED-UNDER-M: {"arm":"7","apply":[{"kind":"sql","stmt":"ALTER POLICY allocator_equity_derived_owner_select ON public.allocator_equity_derived USING (true)"}]}
  v_i := pg_temp.wnd_user();
  v_j := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_i, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_i, DATE '2026-03-10', 4);
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_i, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10'], 5), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (7-SETUP): the seeding call raised % (%), so arm 7 would read a row that was never written', v_state, v_msg;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_i::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_i AND kind = 'snapshot_rebuild_boundary';
  IF v_n <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (7): the owner sees % of its own boundary rows, expected 1', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id <> v_i AND kind = 'snapshot_rebuild_boundary';
  IF v_n <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (7): the owner sees % boundary rows of OTHER allocators, expected 0 - CROSS-TENANT LEAK', v_n;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_j::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived WHERE allocator_id = v_i;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (7): another authenticated user sees % of the owner''s derived rows, expected 0 - CROSS-TENANT LEAK', v_n;
  END IF;

  -- ===== ARM 8 - malformed input: 22023 with its token, nothing written =====
  -- One loop over the guard families. K holds an older row and an in-window row;
  -- its snapshot rows must be identical after every case.
  -- RED-UNDER: make the row_before_window guard in 20261028120000 match nothing,
  --            `WHERE false AND r.asof < p_window_start`. A payload row older than
  --            the window then reaches the INSERT and writes a day the window
  --            never owned (the case carries the stored in-window day too, so the
  --            call succeeds rather than failing on an unreproduced day).
  -- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"   WHERE r.asof < p_window_start;","replace":"   WHERE false AND r.asof < p_window_start;","occurrences":1}]}
  v_k := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_k, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_k, DATE '2026-03-10', 4);
  v_snaps0 := pg_temp.wnd_snaps(v_k);
  v_der0 := pg_temp.wnd_derived(v_k);
  FOR v_case IN
    SELECT * FROM (VALUES
      ('null-allocator', NULL::uuid, v_ws,
         pg_temp.wnd_payload(ARRAY[DATE '2026-03-10'], 5), 'allocator_required'),
      ('null-window', v_k, NULL::date,
         pg_temp.wnd_payload(ARRAY[DATE '2026-03-10'], 5), 'window_start_required'),
      ('null-rows', v_k, v_ws, NULL::jsonb, 'rows_not_a_nonempty_array'),
      ('object-not-array', v_k, v_ws, '{"asof": "2026-03-10"}'::jsonb, 'rows_not_a_nonempty_array'),
      ('empty-array', v_k, v_ws, '[]'::jsonb, 'rows_not_a_nonempty_array'),
      ('element-without-asof', v_k, v_ws, '[{"value_usd": 1}]'::jsonb, 'row_asof_missing'),
      ('before-window', v_k, v_ws,
         pg_temp.wnd_payload(ARRAY[DATE '2026-03-09', DATE '2026-03-10'], 5), 'row_before_window'),
      ('duplicate-asof', v_k, v_ws,
         pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-10'], 5), 'duplicate_asof')
    ) AS t(lbl, palloc, pws, prows, token)
  LOOP
    v_state := NULL; v_msg := NULL;
    BEGIN
      v_ret := public.replace_allocator_equity_snapshots_window(v_case.palloc, v_case.prows, 3, v_case.pws);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state IS DISTINCT FROM '22023' OR v_msg IS NULL OR position(v_case.token IN v_msg) = 0 THEN
      RAISE EXCEPTION 'TEST FAILED (8): case % was not refused with 22023 and token % (SQLSTATE %, message %)', v_case.lbl, v_case.token, COALESCE(v_state, 'none - the call SUCCEEDED'), COALESCE(v_msg, 'none');
    END IF;
    IF pg_temp.wnd_snaps(v_k) IS DISTINCT FROM v_snaps0 OR pg_temp.wnd_derived(v_k) IS DISTINCT FROM v_der0 THEN
      RAISE EXCEPTION 'TEST FAILED (8): case % was refused but left the allocator''s rows changed', v_case.lbl;
    END IF;
  END LOOP;

  -- ===== ARM 9 - privilege posture (AR-1) ===================================
  -- anon and authenticated cannot EXECUTE, service_role can, exactly one overload,
  -- SECURITY DEFINER, search_path = public, pg_temp, lock_timeout = 3s, and the
  -- H-1186 lock key text (the same hashtext prefix delete_allocator_api_key uses).
  -- RED-UNDER: grant EXECUTE on the function to authenticated after the migration
  --            has applied (a post-apply `sql` step: the migration asserts the
  --            privilege posture and an edit would abort the apply). Any signed-in
  --            user could then call a SECURITY DEFINER function that deletes and
  --            rewrites another allocator's equity history by passing that
  --            allocator's id.
  -- RED-UNDER-M: {"arm":"9","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) TO authenticated"}]}
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'replace_allocator_equity_snapshots_window';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (9): % overloads of replace_allocator_equity_snapshots_window exist, expected exactly 1 (PostgREST resolves an RPC by name)', v_n;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (9): anon can EXECUTE replace_allocator_equity_snapshots_window';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (9): authenticated can EXECUTE replace_allocator_equity_snapshots_window - any signed-in user could rewrite another allocator''s history';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (9): service_role cannot EXECUTE replace_allocator_equity_snapshots_window';
  END IF;
  SELECT p.prosecdef, p.proconfig, p.prosrc INTO v_secdef, v_cfg, v_src FROM pg_proc p WHERE p.oid = v_oid;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'TEST FAILED (9): the function is not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_temp') THEN
    RAISE EXCEPTION 'TEST FAILED (9): the function does not pin search_path to public, pg_temp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'lock_timeout=3s') THEN
    RAISE EXCEPTION 'TEST FAILED (9): the function does not carry lock_timeout = 3s';
  END IF;
  IF position('hashtext(''alloc:'' ||' IN v_src) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (9): the lock key is not the alloc-scoped hashtext prefix, so H-1186 serialization against delete_allocator_api_key would not match';
  END IF;

  -- ===== ARM 10 - the CL9 flag persists =====================================
  -- A row flagged true stays true, flagged false stays false, and a row omitting
  -- the field becomes false.
  -- RED-UNDER: replace the INSERT's `COALESCE(r.pre_terminus_balance_unknown,
  --            false)` projection in 20261028120000 with a literal `false`. Every
  --            row then persists false, so a worker that correctly flags an
  --            OKX-terminus replay has its flag silently discarded and the garbage
  --            absolute levels flow back into the equity curve (NEW-C01-11).
  -- RED-UNDER-M: {"arm":"10","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"COALESCE(r.pre_terminus_balance_unknown, false)\n    FROM jsonb_to_recordset(p_rows) AS r(","replace":"false\n    FROM jsonb_to_recordset(p_rows) AS r(","occurrences":1}]}
  v_n1 := pg_temp.wnd_user();
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_n1,
      '[{"asof":"2026-03-10","value_usd":10.0,"breakdown":{"USDT":10.0},"source":"exchange_primary","pre_terminus_balance_unknown":true},
        {"asof":"2026-03-11","value_usd":20.0,"breakdown":{"USDT":20.0},"source":"exchange_primary","pre_terminus_balance_unknown":false},
        {"asof":"2026-03-12","value_usd":30.0,"breakdown":{"USDT":30.0},"source":"exchange_primary"}]'::jsonb,
      3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL OR v_ret IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'TEST FAILED (10-SETUP): the call raised % (%) or returned % instead of 3', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_ret::text, 'NULL');
  END IF;
  SELECT pre_terminus_balance_unknown INTO v_flag1 FROM public.allocator_equity_snapshots WHERE allocator_id = v_n1 AND asof = DATE '2026-03-10';
  SELECT pre_terminus_balance_unknown INTO v_flag2 FROM public.allocator_equity_snapshots WHERE allocator_id = v_n1 AND asof = DATE '2026-03-11';
  SELECT pre_terminus_balance_unknown INTO v_flag3 FROM public.allocator_equity_snapshots WHERE allocator_id = v_n1 AND asof = DATE '2026-03-12';
  IF v_flag1 IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (10): the row flagged true persisted %', COALESCE(v_flag1::text, 'NULL');
  END IF;
  IF v_flag2 IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (10): the row flagged false persisted %', COALESCE(v_flag2::text, 'NULL');
  END IF;
  IF v_flag3 IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (10): the row omitting the flag persisted %, expected false', COALESCE(v_flag3::text, 'NULL');
  END IF;

  -- ===== ARM 11 - the WR-05 depth rule ======================================
  -- With p_depth_months 3 an exchange_primary row stores 3 and a coingecko_fallback
  -- row stores NULL; with p_depth_months NULL every row stores NULL.
  -- RED-UNDER: replace the `CASE WHEN r.source = 'exchange_primary' THEN
  --            p_depth_months ELSE NULL END` projection in 20261028120000 with
  --            plain `p_depth_months`. A fallback-priced row then claims the
  --            venue's retention depth, and the dashboard's warm-up copy names a
  --            depth the row never had.
  -- RED-UNDER-M: {"arm":"11","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"CASE WHEN r.source = 'exchange_primary' THEN p_depth_months ELSE NULL END,\n      COALESCE(r.pre_terminus_balance_unknown, false)\n    FROM jsonb_to_recordset(p_rows) AS r(","replace":"p_depth_months,\n      COALESCE(r.pre_terminus_balance_unknown, false)\n    FROM jsonb_to_recordset(p_rows) AS r(","occurrences":1}]}
  v_n2 := pg_temp.wnd_user();
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_n2,
      '[{"asof":"2026-03-10","value_usd":10.0,"breakdown":{"USDT":10.0},"source":"exchange_primary"},
        {"asof":"2026-03-11","value_usd":20.0,"breakdown":{"USDT":20.0},"source":"coingecko_fallback"}]'::jsonb,
      3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (11-SETUP): the call raised % (%)', v_state, v_msg;
  END IF;
  SELECT history_depth_months INTO v_dep1 FROM public.allocator_equity_snapshots WHERE allocator_id = v_n2 AND asof = DATE '2026-03-10';
  SELECT history_depth_months INTO v_dep2 FROM public.allocator_equity_snapshots WHERE allocator_id = v_n2 AND asof = DATE '2026-03-11';
  IF v_dep1 IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'TEST FAILED (11): the exchange_primary row stored history_depth_months %, expected 3', COALESCE(v_dep1::text, 'NULL');
  END IF;
  IF v_dep2 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (11): the coingecko_fallback row stored history_depth_months %, expected NULL', v_dep2;
  END IF;
  -- NULL depth: every row stores NULL, the exchange_primary row included.
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_n2,
      '[{"asof":"2026-03-10","value_usd":10.0,"breakdown":{"USDT":10.0},"source":"exchange_primary"},
        {"asof":"2026-03-11","value_usd":20.0,"breakdown":{"USDT":20.0},"source":"coingecko_fallback"}]'::jsonb,
      NULL, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (11-SETUP): the NULL-depth call raised % (%)', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_snapshots
   WHERE allocator_id = v_n2 AND history_depth_months IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (11): % rows stored a history_depth_months after a call with p_depth_months NULL, expected 0', v_n;
  END IF;

  -- ===== ARM 12 - a whole-history replace clears the seam record (WR-01) ====
  -- replace_allocator_equity_snapshots deletes EVERY snapshot row of the allocator,
  -- the older kept days the recorded seam separated included, so a boundary row that
  -- survives it names a jump that is no longer in the stored series. O1 holds an
  -- older row, a boundary row and an equity_curve row; O2 holds a boundary row. After
  -- the call as service_role (the worker's caller) O1's boundary row is gone, its
  -- equity_curve row stays, its snapshots are exactly the payload's, and O2's rows are
  -- identical.
  -- RED-UNDER: remove the boundary DELETE from replace_allocator_equity_snapshots in
  --            20261028120000 (make its `rb.kind` test `AND false`). The sole-key
  --            reconstruct then replaces the whole history and leaves a boundary
  --            date describing days that were wiped, which reaches the dashboard
  --            payload as a seam that is not in the series.
  -- RED-UNDER-M: {"arm":"12","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"AND rb.kind = 'snapshot_rebuild_boundary'","replace":"AND false","occurrences":1}]}
  v_o1 := pg_temp.wnd_user();
  v_o2 := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_o1, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_o1, DATE '2026-03-10', 4);
  PERFORM pg_temp.wnd_snap(v_o2, DATE '2026-03-01', 3);
  INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload, computed_at)
  VALUES (v_o1, 'snapshot_rebuild_boundary', '{"boundary_date": "2026-03-10"}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00'),
         (v_o1, 'equity_curve', '{"curve": []}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00'),
         (v_o2, 'snapshot_rebuild_boundary', '{"boundary_date": "2026-03-10"}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00');
  v_der0 := pg_temp.wnd_derived(v_o2);
  v_state := NULL; v_msg := NULL; v_ret := NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots(
      v_o1, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-11'], 5), 3);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_state IS NOT NULL OR v_ret IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (12-SETUP): the whole-history replace raised % (%) or returned % instead of 2', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_ret::text, 'NULL');
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_snapshots WHERE allocator_id = v_o1;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (12): % snapshot rows are stored after the whole-history replace, expected exactly the 2 sent', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_o1 AND kind = 'snapshot_rebuild_boundary';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (12): the boundary row survived a replace that wiped every older day (% rows)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_o1 AND kind = 'equity_curve';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (12): the boundary delete took another derived kind with it (% equity_curve rows left, expected 1)', v_n;
  END IF;
  IF pg_temp.wnd_derived(v_o2) IS DISTINCT FROM v_der0 THEN
    RAISE EXCEPTION 'TEST FAILED (12): another allocator''s derived rows changed';
  END IF;

  -- ===== ARM 13 - the last-key cascade clears the seam record (WR-01) =======
  -- delete_allocator_api_key(key, true) wipes the snapshots only when no key is left.
  -- P1 holds one key: the cascade wipes the snapshots and must clear the boundary row
  -- (equity_curve stays). P2 holds two keys and deletes one: the snapshots stay, so the
  -- boundary row must stay. P3 holds one key and deletes it WITHOUT the cascade: the
  -- snapshots stay, so the boundary row must stay. Every call is made as the signed-in
  -- owner (authenticated), the real caller of this function.
  -- RED-UNDER: remove the boundary DELETE from the last-key cascade of
  --            delete_allocator_api_key in 20261028120000 (make its `ck.kind` test
  --            `AND false`). A user who hard-deletes every key keeps a boundary date
  --            for a series that no longer exists; the next key's sole-key rebuild
  --            starts from it.
  -- RED-UNDER-M: {"arm":"13","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"AND ck.kind = 'snapshot_rebuild_boundary'","replace":"AND false","occurrences":1}]}
  v_p1 := pg_temp.wnd_user();
  v_p2 := pg_temp.wnd_user();
  v_p3 := pg_temp.wnd_user();
  v_pk1 := pg_temp.wnd_key(v_p1);
  v_pk2 := pg_temp.wnd_key(v_p2);
  v_pk3 := pg_temp.wnd_key(v_p2);
  v_pk4 := pg_temp.wnd_key(v_p3);
  PERFORM pg_temp.wnd_snap(v_p1, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_p1, DATE '2026-03-10', 4);
  PERFORM pg_temp.wnd_snap(v_p2, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_p2, DATE '2026-03-10', 4);
  PERFORM pg_temp.wnd_snap(v_p3, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_p3, DATE '2026-03-10', 4);
  INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload, computed_at)
  VALUES (v_p1, 'snapshot_rebuild_boundary', '{"boundary_date": "2026-03-10"}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00'),
         (v_p1, 'equity_curve', '{"curve": []}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00'),
         (v_p2, 'snapshot_rebuild_boundary', '{"boundary_date": "2026-03-10"}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00'),
         (v_p3, 'snapshot_rebuild_boundary', '{"boundary_date": "2026-03-10"}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00');
  v_state := NULL; v_msg := NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.delete_allocator_api_key(v_pk1, true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (13-SETUP): the last-key hard delete raised % (%)', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_snapshots WHERE allocator_id = v_p1;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (13-SETUP): the last-key cascade left % snapshot rows, so the arm cannot judge the boundary row', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_p1 AND kind = 'snapshot_rebuild_boundary';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (13): the boundary row survived the last-key cascade that wiped every snapshot (% rows)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_p1 AND kind = 'equity_curve';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (13): the boundary delete took another derived kind with it (% equity_curve rows left, expected 1)', v_n;
  END IF;
  -- P2: another key remains, the cascade wipes nothing.
  v_state := NULL; v_msg := NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.delete_allocator_api_key(v_pk2, true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (13-SETUP): the multi-key delete raised % (%)', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_snapshots WHERE allocator_id = v_p2;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (13): a cascade delete of one of two keys changed the snapshot rows (% left, expected 2)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_p2 AND kind = 'snapshot_rebuild_boundary';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (13): the boundary row of an allocator whose snapshots were kept was cleared (% rows, expected 1)', v_n;
  END IF;
  -- P3: the last key goes without the cascade, the snapshots stay.
  v_state := NULL; v_msg := NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p3::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.delete_allocator_api_key(v_pk4, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (13-SETUP): the delete without cascade raised % (%)', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_snapshots WHERE allocator_id = v_p3;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (13): a delete without the cascade changed the snapshot rows (% left, expected 2)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_equity_derived
   WHERE allocator_id = v_p3 AND kind = 'snapshot_rebuild_boundary';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (13): the boundary row was cleared by a delete that kept the snapshots (% rows, expected 1)', v_n;
  END IF;

  -- ===== ARM 14 - the seam is the first rebuilt day (WR-01) =================
  -- Q holds an older row and is rebuilt over a window starting 2026-03-10, but the
  -- payload's first day is 2026-03-12 (the venue's history began later). The jump sits
  -- between the kept 2026-03-01 and the first rebuilt day 2026-03-12, so the boundary
  -- row must hold exactly {"boundary_date": "2026-03-12"}, not the window start.
  -- RED-UNDER: write `p_window_start` instead of the first inserted day into the
  --            boundary payload in 20261028120000. The row then names a date that is
  --            earlier than the first rebuilt day, a seam position that is not where
  --            the stored values jump.
  -- RED-UNDER-M: {"arm":"14","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"to_char(v_seam, 'YYYY-MM-DD')","replace":"to_char(p_window_start, 'YYYY-MM-DD')","occurrences":1}]}
  v_q := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_q, DATE '2026-03-01', 3);
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_q, pg_temp.wnd_payload(ARRAY[DATE '2026-03-12', DATE '2026-03-13'], 5), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (14): the call raised % (%) instead of recording the boundary', v_state, v_msg;
  END IF;
  IF (SELECT payload FROM public.allocator_equity_derived
       WHERE allocator_id = v_q AND kind = 'snapshot_rebuild_boundary')
     IS DISTINCT FROM '{"boundary_date": "2026-03-12"}'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (14): the boundary payload is %, expected the first rebuilt day {"boundary_date": "2026-03-12"}',
      COALESCE((SELECT payload::text FROM public.allocator_equity_derived WHERE allocator_id = v_q AND kind = 'snapshot_rebuild_boundary'), 'NULL');
  END IF;

  -- ===== ARM 15 - a later window call keeps the earliest seam (WR-01) =======
  -- R is rebuilt twice. The first call (window 2026-03-10) records the seam
  -- 2026-03-10 over the kept 2026-03-01. The second call, a later UTC day's window
  -- starting 2026-03-12, replaces only days after that; the seam between the kept
  -- 2026-03-01 and the first rebuilt day is still 2026-03-10, and 2026-03-01 still
  -- precedes it, so the row must still say 2026-03-10. S holds a stale boundary row
  -- dated before every stored day, so no kept row precedes it and the new seam
  -- (2026-03-10) replaces it.
  -- RED-UNDER: make the keep-the-earlier-seam test in 20261028120000 `WHEN false AND`.
  --            Every later window call then moves the seam forward over days that
  --            were already rebuilt, where the stored values need not jump at all,
  --            and the real seam is named nowhere.
  -- RED-UNDER-M: {"arm":"15","apply":[{"kind":"edit","file":"supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql","find":"WHEN (allocator_equity_derived.payload ->> 'boundary_date')::date < v_seam","replace":"WHEN false AND (allocator_equity_derived.payload ->> 'boundary_date')::date < v_seam","occurrences":1}]}
  v_r := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_r, DATE '2026-03-01', 3);
  PERFORM pg_temp.wnd_snap(v_r, DATE '2026-03-10', 4);
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_r, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-11'], 5), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (15-SETUP): the first call raised % (%)', v_state, v_msg;
  END IF;
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_r, pg_temp.wnd_payload(ARRAY[DATE '2026-03-12', DATE '2026-03-13'], 6), 3, DATE '2026-03-12');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (15): the second call raised % (%)', v_state, v_msg;
  END IF;
  IF (SELECT payload FROM public.allocator_equity_derived
       WHERE allocator_id = v_r AND kind = 'snapshot_rebuild_boundary')
     IS DISTINCT FROM '{"boundary_date": "2026-03-10"}'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (15): a later window call left the boundary payload at %, expected the earlier seam {"boundary_date": "2026-03-10"}',
      COALESCE((SELECT payload::text FROM public.allocator_equity_derived WHERE allocator_id = v_r AND kind = 'snapshot_rebuild_boundary'), 'NULL');
  END IF;
  -- A stale row with no kept day before it is replaced by the new seam.
  v_s := pg_temp.wnd_user();
  PERFORM pg_temp.wnd_snap(v_s, DATE '2026-03-08', 3);
  INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload, computed_at)
  VALUES (v_s, 'snapshot_rebuild_boundary', '{"boundary_date": "2026-03-05"}'::jsonb, TIMESTAMPTZ '2026-02-02 00:00:00+00');
  v_state := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.replace_allocator_equity_snapshots_window(
      v_s, pg_temp.wnd_payload(ARRAY[DATE '2026-03-10', DATE '2026-03-11'], 5), 3, v_ws);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (15): the call over a stale boundary row raised % (%)', v_state, v_msg;
  END IF;
  IF (SELECT payload FROM public.allocator_equity_derived
       WHERE allocator_id = v_s AND kind = 'snapshot_rebuild_boundary')
     IS DISTINCT FROM '{"boundary_date": "2026-03-10"}'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (15): a stale boundary row with no kept day before it was not replaced, payload %, expected {"boundary_date": "2026-03-10"}',
      COALESCE((SELECT payload::text FROM public.allocator_equity_derived WHERE allocator_id = v_s AND kind = 'snapshot_rebuild_boundary'), 'NULL');
  END IF;

  RAISE NOTICE 'ALL 15 ARMS EXECUTED (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15): the window replace leaves another allocator alone (1), replaces the window-start day too (2), keeps older rows byte-identical (3), refuses an unreproduced stored day including one that arrived after the payload was built and changes nothing (4, 4-LATE), records the seam exactly once and removes it when no older day is kept (5), works as service_role and records the owner attributes that admitted the FORCE-RLS write (6), shows the boundary row to its owner only (7), refuses eight malformed inputs with their tokens (8), is executable by service_role alone as a SECURITY DEFINER with a pinned search_path, lock_timeout and lock key (9), persists the CL9 flag (10), applies the depth only to exchange_primary rows (11), has the whole-history replace clear the boundary row (12), has the last-key cascade clear it (13), names the first rebuilt day as the seam (14) and keeps the earliest seam over later window calls (15).';
END $$;

ROLLBACK;
