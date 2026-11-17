-- Test: public.mt5_server_clock_readings (Phase 155.1 SERVERCLOCK, plan 04). Guards migration
-- 20261117120000_mt5_server_clock_readings.sql.
--
-- Background
-- ----------
-- Inside every leased MT5 derive the worker takes one live server-clock reading and
-- stores it, once, for EVERY verdict (match, mismatch, unmeasured) before it decides
-- anything (D-13..D-16). The rows are the evidence the founder's 155.2 session and a future
-- clock-rule change rest on, so this gate proves the table contract at the database
-- boundary:
--   public.mt5_server_clock_readings   one row per live reading, per key, with its value
--                                      rules, its access rule and a refusing trigger.
--   SC-1  PER KEY, erased with the key and the account through ON DELETE CASCADE, KEPT by a
--         soft disconnect (D-16: disconnect, never delete).
--   SC-2  job_id carries NO foreign key: compute_jobs rows expire, a reading outlives them.
--   D-15  SERVICE-ROLE ONLY. Row level security is enabled and forced with NO policy;
--         anon and authenticated hold nothing; service_role holds SELECT and INSERT.
--   D-14  WRITE-ONCE against EVERY role. The grant withdraws UPDATE, DELETE and TRUNCATE
--         from service_role, and the BEFORE UPDATE OR DELETE row trigger refuses every
--         UPDATE and every DIRECT DELETE from the table owner and BYPASSRLS roles too.
--   D-20(c) The same trigger lets the api_keys foreign key cascade through (trigger depth
--         greater than one), so delete_allocator_api_key and an auth user delete still
--         erase the readings while an unrelated user's reading stays. Assumption A6
--         (RI-driven cascades fire the trigger nested) is PROVEN on the lane by arms 7a and 7b.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each twin's
-- FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend on arms listed
-- before it; every arm seeds its own users and keys):
--   1   anon and authenticated each get SELECT and INSERT refused with 42501 and the pinned
--       text `permission denied for table mt5_server_clock_readings`; nothing is stored.
--   2   service_role INSERTs one row per verdict shape (a match; a mismatch; an unmeasured
--       row for each of the five reasons) and each lands, with no sequence grant to find.
--   3a-3j  each value rule refuses with 23514 naming its OWN constraint, one identity per
--       rule so one CHECK can never stand in for another: configured rule (3a), verdict
--       (3b), reason set (3c), reason/verdict coupling (3d), a match with unequal offsets
--       and a mismatch with equal offsets (3e), a match with a NULL measured offset (3f),
--       a mismatch with a NULL expected offset (3g), server label hash shape (3h), negative
--       symbols_visible (3i), negative symbols_answered (3j).
--   4a  service_role UPDATE is refused 42501 by the PRIVILEGE (not the trigger); row unchanged.
--   4b  service_role DELETE is refused 42501 by the PRIVILEGE; the row is still there.
--   4c  service_role TRUNCATE is refused 42501 by the PRIVILEGE; the row is still there.
--   5   a table-OWNER UPDATE is refused by the TRIGGER (check_violation carrying the trigger's
--       text); the row is unchanged. Only the trigger can answer this: a grant does not bind
--       the owner.
--   6   a table-OWNER direct DELETE is refused by the trigger at trigger depth 1; the row is
--       still there.
--   7a  soft disconnect first: setting api_keys.disconnected_at leaves the key's readings in
--       place (D-16). Then delete_allocator_api_key(key, false), called as the owning user,
--       erases that key's readings through the cascade (the trigger admits depth >= 2).
--   7b  an auth user deleted takes its key's readings with it, and a third user's reading
--       stays.
--   8   deleting a compute_jobs row leaves the readings that carry its id, and the
--       catalogue shows no foreign key from the table to compute_jobs.
--   9a  catalogue: row level security enabled AND forced, no policy, and the exact per-role
--       privilege matrix (service_role SELECT and INSERT, nothing else).
--   9b  catalogue: the trigger is present, enabled, BEFORE, FOR EACH ROW, on UPDATE and DELETE
--       only (tgtype exactly 27) and runs the write-once function.
--   9c  catalogue: the trigger function is SECURITY INVOKER (not definer).
--   9d  catalogue: neither anon nor authenticated may EXECUTE the trigger function.
--
-- ORDERING RULE for the twins. Every row outside arms 3a-3j's refusals is legitimate, and
-- each of those breaks exactly ONE rule (PostgreSQL evaluates CHECK constraints in NAME
-- order, so a row that broke two would report the one that sorts first). Rows are only ever
-- deleted by arms 6 (refused), 7a and 7b (the erasures under test) and 8 (a compute_jobs
-- row); no arm seeds a row another arm reads.
--
-- IDENTITIES. The mutation runner needs ONE unique arm id per twin (GRAMMAR.md, `arm`:
-- unique within the file) and an arm's first-failure identity must be its own, so every
-- independent defect has its own identity: 3a-3j, 4a-4c, 7a-7b, 9a-9d. The sentinel counts
-- every identity named in its roster.
--
-- ⭐ WHY 7a AND 7b ARE TWO ARMS WITH DIFFERENT MUTATIONS. Both erasure paths reach the readings
-- at the same trigger depth (measured 2026-11-17 on the lane: direct DELETE depth 1,
-- delete_allocator_api_key depth 2, auth user delete depth 2), so no single depth edit can make
-- one path fail and not the other, and a twin whose first failure names the OTHER arm is not a
-- bite. 7a is bitten by refusing the cascade outright (a depth test nothing reaches), 7b by
-- admitting the cascade only for a signed-in caller: 7a runs with request.jwt.claims set and
-- passes, 7b runs with them cleared and is refused. That second edit is a real regression
-- shape (an account erasure run by an operator, with no signed-in user, would stop erasing).
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the table is an EXCEPTION in arm 1, never a skip.
-- Merging supabase/migrations/** applies to PRODUCTION with no human stop, so nothing in the
-- merge path would make a missing object appear. Do not add a presence skip.
--
-- SENTINEL. The final `ALL 24 ARMS EXECUTED (...)` notice at the foot of this file, before
-- ROLLBACK, joins ci.yml's `sql-tests` sentinel census. That census (and the mutation floors
-- and every other pin that counts gate files) is moved by plan 05 of this phase, not here.
--
-- Every identity carries a digit. Every `TEST FAILED (N)` raise sits DIRECTLY in the DO body
-- (the mutation runner reads an identity only from a single-frame `inline_code_block` raise);
-- the helpers below return values and never raise an identity.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on failure, no
-- psql meta-commands. The UPDATE, DELETE and TRUNCATE statements in this file are the ones
-- arms 4a-6 expect to be REFUSED, the erasures arms 7a and 7b expect to be ADMITTED, and the
-- compute_jobs delete of arm 8. The whole test rolls back. Seed data is synthetic: generated
-- uuids, @invalid.local emails and invented offsets; no message names a uuid or a value.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm below carries a prose `RED-UNDER:` and a machine-readable
-- `RED-UNDER-M:` twin the mutation runner applies on a throwaway pg-lane cluster to PROVE the
-- arm reds on its own, then restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. Every
-- twin edits the migration that DEFINES what it mutates, 20261117120000. The migration's own
-- verify block is catalogue-only and asserts only that the table, the trigger function and
-- the trigger resolve by name, so each edit below leaves those standing and the mutated
-- migration applies clean; the gate, not the apply, is what speaks.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql","supabase/migrations/20261117120000_mt5_server_clock_readings.sql"]}
-- ⚠️ 07-fixture-supabase-default-privileges.sql is what makes the REVOKE falsifiable: the table
-- is created by a migration IN this list, so Supabase's bootstrap default privileges hand
-- anon, authenticated and service_role the ALL grant they hold in production, and arms 1, 4a-4c,
-- 9a and 9d can only redden because that grant is there to be withdrawn or not.
-- 41-fixture-api-keys-user-id-fk.sql makes the account deletion reach api_keys, and the api_keys
-- soft-disconnect column comes from 03-fixture-compute-jobs.sql in this lane.

BEGIN;

-- Seeds one auth user. pg_temp functions live and die with this transaction and carry no arm.
CREATE FUNCTION pg_temp.sc_user() RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'sc-' || v_user::text || '@invalid.local', now(), now());
  RETURN v_user;
END
$f$;

-- Seeds one api_keys row (and the profile it hangs off) for a user.
CREATE FUNCTION pg_temp.sc_key(p_user uuid) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_key uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (p_user, 'sc', 'allocator')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, p_user, 'mt5', 'sc', 'x');
  RETURN v_key;
END
$f$;

-- A valid row of the given verdict shape, as jsonb. A match carries equal offsets, a mismatch
-- unequal ones, an unmeasured row a reason and no offsets. Callers override single fields with
-- the jsonb `||` operator (a JSON null sets the column NULL), so each refusal case below breaks
-- exactly one rule. jsonb_populate_record leaves a missing field NULL and applies no column
-- default, so every NOT NULL column the INSERT names is set here.
CREATE FUNCTION pg_temp.sc_row(p_key uuid, p_verdict text, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE
  v_row jsonb;
BEGIN
  v_row := jsonb_build_object(
    'api_key_id', p_key,
    'job_id', NULL,
    'read_at', now(),
    'configured_rule', 'us',
    'verdict', p_verdict,
    'reason', p_reason,
    'newest_tick_wall_ms', 1760000000000,
    'raw_offset_s', NULL,
    'measured_offset_s', NULL,
    'expected_offset_s', NULL,
    'residual_s', NULL,
    'newest_tick_age_s', NULL,
    'symbols_visible', 12,
    'symbols_answered', 9,
    'server_label_hash', NULL);
  IF p_verdict = 'match' THEN
    v_row := v_row || jsonb_build_object('raw_offset_s', 10800.2, 'measured_offset_s', 10800,
      'expected_offset_s', 10800, 'residual_s', -0.2, 'newest_tick_age_s', 0.5);
  ELSIF p_verdict = 'mismatch' THEN
    v_row := v_row || jsonb_build_object('raw_offset_s', 7200.1, 'measured_offset_s', 7200,
      'expected_offset_s', 10800, 'residual_s', -0.1, 'newest_tick_age_s', 3599.9);
  END IF;
  IF p_reason IN ('no_tick', 'tick_read_failed') THEN
    v_row := v_row || jsonb_build_object('newest_tick_wall_ms', NULL);
  END IF;
  RETURN v_row;
END
$f$;

-- Tries to insert the row described by p_row as the CURRENT role. Returns 'OK' when the row
-- was stored, else `SQLSTATE|message`. It never raises, so the arm that called it decides what
-- the outcome means.
CREATE FUNCTION pg_temp.sc_try(p_row jsonb) RETURNS text
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.mt5_server_clock_readings
    (api_key_id, job_id, read_at, configured_rule, verdict, reason, newest_tick_wall_ms,
     raw_offset_s, measured_offset_s, expected_offset_s, residual_s, newest_tick_age_s,
     symbols_visible, symbols_answered, server_label_hash)
  SELECT r.api_key_id, r.job_id, r.read_at, r.configured_rule, r.verdict, r.reason,
         r.newest_tick_wall_ms, r.raw_offset_s, r.measured_offset_s, r.expected_offset_s,
         r.residual_s, r.newest_tick_age_s, r.symbols_visible, r.symbols_answered,
         r.server_label_hash
    FROM jsonb_populate_record(NULL::public.mt5_server_clock_readings, p_row) r;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

-- Tries to read a count from the table as the CURRENT role. 'OK' when the read was allowed,
-- else `SQLSTATE|message`.
CREATE FUNCTION pg_temp.sc_try_sel() RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings;
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
  v_state  text;
  v_msg    text;
  v_out    text;
  v_img1   jsonb;
  v_img2   jsonb;
  v_job    uuid;
  v_oid    oid := to_regclass('public.mt5_server_clock_readings');
  v_role   text;
  v_priv   text;
  v_want   boolean;
  v_got    boolean;
  v_case   RECORD;
  v_trg    RECORD;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): public.mt5_server_clock_readings does not exist - this gate has nothing to test and must not skip';
  END IF;

  -- ===== ARM 1 - anon and authenticated reach nothing (D-15, T-155.1-14) ======
  -- Each of the two roles is refused SELECT and INSERT by the table PRIVILEGE: the message is
  -- pinned, because forced row level security with no policy would also answer 42501 ("new
  -- row violates row-level security policy") and hide a stray INSERT grant behind it. A SELECT
  -- cannot be hidden that way (no policy means zero rows, not an error), so a stray SELECT
  -- grant answers NO error.
  -- RED-UNDER: drop anon and authenticated from the REVOKE in 20261117120000, the "the
  --            dashboard could show the readings" drift. The bootstrap default privileges then
  --            leave both roles their ALL grant, forced row level security with zero policies
  --            still shows them zero rows, and only the refusal itself sees the grant.
-- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"REVOKE ALL ON TABLE public.mt5_server_clock_readings FROM PUBLIC, anon, authenticated, service_role;","replace":"REVOKE ALL ON TABLE public.mt5_server_clock_readings FROM PUBLIC, service_role;","occurrences":1}]}
  v_a := pg_temp.sc_user();
  v_ka := pg_temp.sc_key(v_a);
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    PERFORM set_config('request.jwt.claims',
      CASE WHEN v_role = 'authenticated'
           THEN json_build_object('sub', v_a::text, 'role', 'authenticated')::text
           ELSE NULL END, true);
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    v_out := pg_temp.sc_try_sel();
    IF v_out NOT LIKE '42501|permission denied for table mt5_server_clock_readings%' THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (1): % SELECT on mt5_server_clock_readings answered %, expected 42501 permission denied for the table', v_role, v_out;
    END IF;
    v_out := pg_temp.sc_try(pg_temp.sc_row(v_ka, 'match'));
    IF v_out NOT LIKE '42501|permission denied for table mt5_server_clock_readings%' THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (1): % INSERT into mt5_server_clock_readings answered %, expected 42501 permission denied for the table', v_role, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END;
    END IF;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): % row(s) were stored by a role that may not write', v_n;
  END IF;

  -- ===== ARM 2 - service_role stores every verdict shape (D-13, D-15) =========
  -- One row per shape the worker writes: a match, a mismatch, and an unmeasured row for each
  -- of the five reasons. service_role holds no sequence grant, so this also proves the
  -- identity column needs none. A match row carries a well-formed server label hash.
  -- RED-UNDER: withdraw INSERT from the one service_role grant in 20261117120000, the "the
  --            worker only needs to read" drift. The worker's first reading insert is then
  --            refused and every leased MT5 derive ends FAILED transient.
-- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"GRANT SELECT, INSERT ON public.mt5_server_clock_readings TO service_role;","replace":"GRANT SELECT ON public.mt5_server_clock_readings TO service_role;","occurrences":1}]}
  v_u := pg_temp.sc_user();
  v_k := pg_temp.sc_key(v_u);
  SET LOCAL ROLE service_role;
  FOR v_case IN
    SELECT t.label, t.row_json FROM (VALUES
      ('match', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('server_label_hash', repeat('ab', 32))),
      ('mismatch', pg_temp.sc_row(v_k, 'mismatch')),
      ('unmeasured no_tick', pg_temp.sc_row(v_k, 'unmeasured', 'no_tick')),
      ('unmeasured tick_read_failed', pg_temp.sc_row(v_k, 'unmeasured', 'tick_read_failed')),
      ('unmeasured residual_over_bound', pg_temp.sc_row(v_k, 'unmeasured', 'residual_over_bound')),
      ('unmeasured tick_time_out_of_range', pg_temp.sc_row(v_k, 'unmeasured', 'tick_time_out_of_range')),
      ('unmeasured expected_unassertable', pg_temp.sc_row(v_k, 'unmeasured', 'expected_unassertable'))
    ) AS t(label, row_json)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out <> 'OK' THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (2): service_role INSERT of a % row answered %, expected it to be accepted', v_case.label, v_out;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_k;
  RESET ROLE;
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'TEST FAILED (2): % row(s) are stored for the key, expected exactly 7', v_n;
  END IF;

  -- ===== ARM 3 - value checks (SC-4, D-13, T-155.1-16) ========================
  -- Each refusal is a CHECK violation (23514) naming its own constraint. The legitimate row
  -- went in first (arm 2) so the checks are shown not to be over-strict. Every case breaks
  -- exactly ONE rule.
  v_u := pg_temp.sc_user();
  v_k := pg_temp.sc_key(v_u);
  SET LOCAL ROLE service_role;

  -- 3a: the clock rule set.
  -- RED-UNDER: reduce the rule CHECK in 20261117120000 to a non-empty test. A rule the worker
  --            never writes ('cet') is stored and the readings no longer say which configured
  --            clock they were assessed against.
-- RED-UNDER-M: {"arm":"3a","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"CHECK (configured_rule IN ('eu', 'us', 'fixed'))","replace":"CHECK (configured_rule <> '')","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('rule outside the set', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('configured_rule', 'cet'), 'mt5_server_clock_readings_rule_chk'),
      ('rule upper case', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('configured_rule', 'EU'), 'mt5_server_clock_readings_rule_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3a): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 3b: the verdict set. The offsets are unequal and the reason NULL so that this is the ONLY
  -- rule the row breaks (a non-match verdict with unequal offsets satisfies the offsets rule).
  -- RED-UNDER: reduce the verdict CHECK in 20261117120000 to a non-empty test. A verdict the
  --            worker never writes ('maybe') is stored and the derive's refuse-on-mismatch
  --            reading can no longer be told from a stray value.
-- RED-UNDER-M: {"arm":"3b","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"CHECK (verdict IN ('match', 'mismatch', 'unmeasured'))","replace":"CHECK (verdict <> '')","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('verdict outside the set', pg_temp.sc_row(v_k, 'mismatch') || jsonb_build_object('verdict', 'maybe'), 'mt5_server_clock_readings_verdict_chk'),
      ('verdict upper case', pg_temp.sc_row(v_k, 'mismatch') || jsonb_build_object('verdict', 'MISMATCH'), 'mt5_server_clock_readings_verdict_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3b): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 3c: the reason set. An unmeasured row with a reason outside the five.
  -- RED-UNDER: make the reason CHECK in 20261117120000 accept any non-NULL reason. A reason
  --            the worker never writes is stored and the parity between the worker's closed
  --            set and the table's is lost.
-- RED-UNDER-M: {"arm":"3c","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"CHECK (reason IS NULL OR reason IN (","replace":"CHECK (reason IS NULL OR reason IS NOT NULL OR reason IN (","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('reason outside the set', pg_temp.sc_row(v_k, 'unmeasured', 'because'), 'mt5_server_clock_readings_reason_chk'),
      ('reason upper case', pg_temp.sc_row(v_k, 'unmeasured', 'NO_TICK'), 'mt5_server_clock_readings_reason_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3c): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 3d: the reason/verdict coupling. A reason exactly when the verdict is unmeasured.
  -- RED-UNDER: drop the coupling CHECK in 20261117120000 (make it always true). A match row
  --            carrying a reason, or an unmeasured row carrying none, is stored, and the
  --            readings no longer say why a reading was not asserted.
-- RED-UNDER-M: {"arm":"3d","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"CHECK ((verdict = 'unmeasured') = (reason IS NOT NULL))","replace":"CHECK (true)","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('match carrying a reason', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('reason', 'no_tick'), 'mt5_server_clock_readings_reason_verdict_chk'),
      ('mismatch carrying a reason', pg_temp.sc_row(v_k, 'mismatch') || jsonb_build_object('reason', 'residual_over_bound'), 'mt5_server_clock_readings_reason_verdict_chk'),
      ('unmeasured without a reason', pg_temp.sc_row(v_k, 'unmeasured', 'no_tick') || jsonb_build_object('reason', NULL), 'mt5_server_clock_readings_reason_verdict_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3d): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 3e: an asserted verdict agrees with its offsets. A match has equal offsets, a mismatch
  -- unequal ones.
  -- RED-UNDER: drop the equality half of the offsets CHECK in 20261117120000. A match row
  --            whose measured and expected offsets differ, or a mismatch whose offsets are
  --            equal, is stored, and a stored verdict can contradict its own numbers.
-- RED-UNDER-M: {"arm":"3e","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"AND ((verdict = 'match') = (measured_offset_s = expected_offset_s))","replace":"AND true","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('match with unequal offsets', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('expected_offset_s', 7200), 'mt5_server_clock_readings_offsets_chk'),
      ('mismatch with equal offsets', pg_temp.sc_row(v_k, 'mismatch') || jsonb_build_object('measured_offset_s', 10800), 'mt5_server_clock_readings_offsets_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3e): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 3f: an asserted verdict carries a measured offset.
  -- RED-UNDER: drop the measured-offset NOT NULL half of the offsets CHECK in 20261117120000.
  --            A match or mismatch row with no measured offset is stored, because a NULL
  --            comparison is neither true nor false and a CHECK admits it.
-- RED-UNDER-M: {"arm":"3f","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"OR (measured_offset_s IS NOT NULL","replace":"OR (true","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('match with no measured offset', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('measured_offset_s', NULL), 'mt5_server_clock_readings_offsets_chk'),
      ('mismatch with no measured offset', pg_temp.sc_row(v_k, 'mismatch') || jsonb_build_object('measured_offset_s', NULL), 'mt5_server_clock_readings_offsets_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3f): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 3g: an asserted verdict carries an expected offset.
  -- RED-UNDER: drop the expected-offset NOT NULL half of the offsets CHECK in 20261117120000.
  --            A match or mismatch row with no expected offset (the repeated or skipped hour,
  --            which is unmeasured by rule) is stored as an asserted verdict.
-- RED-UNDER-M: {"arm":"3g","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"AND expected_offset_s IS NOT NULL","replace":"AND true","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('mismatch with no expected offset', pg_temp.sc_row(v_k, 'mismatch') || jsonb_build_object('expected_offset_s', NULL), 'mt5_server_clock_readings_offsets_chk'),
      ('match with no expected offset', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('expected_offset_s', NULL), 'mt5_server_clock_readings_offsets_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3g): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 3h: the server label hash is a lower-case hex SHA-256, or NULL.
  -- RED-UNDER: drop the hash-shape CHECK in 20261117120000. A raw server name, or any other
  --            string, is stored in a column the design says only ever holds a hash (D-17).
-- RED-UNDER-M: {"arm":"3h","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"CHECK (server_label_hash IS NULL OR server_label_hash ~ '^[0-9a-f]{64}$')","replace":"CHECK (true)","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('hash not hex', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('server_label_hash', 'a-broker-server-name'), 'mt5_server_clock_readings_hash_chk'),
      ('hash too short', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('server_label_hash', repeat('ab', 31)), 'mt5_server_clock_readings_hash_chk'),
      ('hash upper case', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('server_label_hash', repeat('AB', 32)), 'mt5_server_clock_readings_hash_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3h): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 3i: symbols_visible is never negative.
  -- RED-UNDER: loosen the symbols_visible half of the counts CHECK in 20261117120000 to admit
  --            negatives. A count of visible symbols below zero is stored.
-- RED-UNDER-M: {"arm":"3i","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"CHECK ((symbols_visible IS NULL OR symbols_visible >= 0)","replace":"CHECK ((symbols_visible IS NULL OR symbols_visible >= -1000000)","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('negative symbols_visible', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('symbols_visible', -1), 'mt5_server_clock_readings_counts_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3i): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 3j: symbols_answered is never negative, then the count of what was stored.
  -- RED-UNDER: loosen the symbols_answered half of the counts CHECK in 20261117120000 to admit
  --            negatives. A count of answered symbols below zero is stored.
-- RED-UNDER-M: {"arm":"3j","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"AND (symbols_answered IS NULL OR symbols_answered >= 0))","replace":"AND (symbols_answered IS NULL OR symbols_answered >= -1000000))","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('negative symbols_answered', pg_temp.sc_row(v_k, 'match') || jsonb_build_object('symbols_answered', -1), 'mt5_server_clock_readings_counts_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.sc_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (3j): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_k;
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (3j): % row(s) are stored for the key, expected none (every case above is a refusal)', v_n;
  END IF;

  -- ===== ARM 4 - service_role cannot UPDATE, DELETE or TRUNCATE (D-14, T-155.1-13) ====
  -- Each is refused by the table PRIVILEGE (42501, pinned text), not by the trigger; the row
  -- is read back unchanged or still there. Identity 4a UPDATE, 4b DELETE, 4c TRUNCATE.
  v_u := pg_temp.sc_user();
  v_k := pg_temp.sc_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.sc_try(pg_temp.sc_row(v_k, 'match'));
  IF v_out <> 'OK' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (4a): service_role INSERT of a legitimate row answered %, expected it to be accepted', v_out;
  END IF;
  SELECT to_jsonb(t) INTO v_img1 FROM public.mt5_server_clock_readings t WHERE t.api_key_id = v_k;

  -- 4a: UPDATE.
  -- RED-UNDER: widen the one service_role grant in 20261117120000 to include UPDATE, the "the
  --            worker may want to correct a reading" drift. The grant refusal then gives way
  --            to the trigger's 23514, so the 42501 this arm pins disappears.
-- RED-UNDER-M: {"arm":"4a","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"GRANT SELECT, INSERT ON public.mt5_server_clock_readings TO service_role;","replace":"GRANT SELECT, INSERT, UPDATE ON public.mt5_server_clock_readings TO service_role;","occurrences":1}]}
  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.mt5_server_clock_readings SET symbols_visible = 99 WHERE api_key_id = v_k;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'permission denied for table mt5_server_clock_readings%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (4a): service_role UPDATE of a stored reading answered % (%), expected 42501 permission denied for the table', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the update ran');
  END IF;
  SELECT to_jsonb(t) INTO v_img2 FROM public.mt5_server_clock_readings t WHERE t.api_key_id = v_k;
  IF v_img1 IS DISTINCT FROM v_img2 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (4a): the stored row changed although the UPDATE was refused';
  END IF;

  -- 4b: DELETE.
  -- RED-UNDER: widen the one service_role grant in 20261117120000 to include DELETE. The
  --            grant refusal then gives way to the trigger's 23514 (a direct delete is
  --            still refused), so the 42501 this arm pins disappears.
-- RED-UNDER-M: {"arm":"4b","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"GRANT SELECT, INSERT ON public.mt5_server_clock_readings TO service_role;","replace":"GRANT SELECT, INSERT, DELETE ON public.mt5_server_clock_readings TO service_role;","occurrences":1}]}
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM public.mt5_server_clock_readings WHERE api_key_id = v_k;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'permission denied for table mt5_server_clock_readings%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (4b): service_role DELETE answered % (%), expected 42501 permission denied for the table', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the delete ran');
  END IF;

  -- 4c: TRUNCATE. A row trigger does not see TRUNCATE, so the grant alone refuses it.
  -- RED-UNDER: widen the one service_role grant in 20261117120000 to include TRUNCATE. Every
  --            reading of every key can then be emptied in one statement, and the DELETE
  --            refusal above never sees it.
-- RED-UNDER-M: {"arm":"4c","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"GRANT SELECT, INSERT ON public.mt5_server_clock_readings TO service_role;","replace":"GRANT SELECT, INSERT, TRUNCATE ON public.mt5_server_clock_readings TO service_role;","occurrences":1}]}
  v_state := NULL; v_msg := NULL;
  BEGIN
    TRUNCATE public.mt5_server_clock_readings;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'permission denied for table mt5_server_clock_readings%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (4c): service_role TRUNCATE answered % (%), expected 42501 permission denied for the table', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the truncate ran');
  END IF;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_k;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (4c): % row(s) remain for the key after the refused DELETE and TRUNCATE, expected 1', v_n;
  END IF;

  -- ===== ARM 5 - the table OWNER cannot UPDATE a reading (D-14, T-155.1-13) ====
  -- The session role here is the table owner (a superuser on the lane), which no grant binds
  -- and row level security does not touch. Only the trigger can refuse this: a check_violation
  -- carrying the trigger's own text, and the stored row read back unchanged.
  -- RED-UNDER: replace the UPDATE refusal in the trigger function of 20261117120000 with a
  --            plain RETURN NEW, the "the trigger is only a backstop" drift. The grant still
  --            refuses service_role (arm 4a), but the owner and every BYPASSRLS role can then
  --            rewrite a stored reading.
-- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"    RAISE EXCEPTION 'mt5_server_clock_readings is write-once: a stored reading is never updated'\n      USING ERRCODE = 'check_violation';","replace":"    RETURN NEW;","occurrences":1}]}
  v_u := pg_temp.sc_user();
  v_k := pg_temp.sc_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.sc_try(pg_temp.sc_row(v_k, 'match'));
  RESET ROLE;
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (5): service_role INSERT of a legitimate row answered %, expected it to be accepted', v_out;
  END IF;
  SELECT to_jsonb(t) INTO v_img1 FROM public.mt5_server_clock_readings t WHERE t.api_key_id = v_k;
  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.mt5_server_clock_readings SET symbols_visible = 99 WHERE api_key_id = v_k;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '23514' OR v_msg NOT LIKE 'mt5_server_clock_readings is write-once: a stored reading is never updated%' THEN
    RAISE EXCEPTION 'TEST FAILED (5): an owner UPDATE of a stored reading answered % (%), expected the trigger''s 23514 write-once refusal', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the update ran');
  END IF;
  SELECT to_jsonb(t) INTO v_img2 FROM public.mt5_server_clock_readings t WHERE t.api_key_id = v_k;
  IF v_img1 IS DISTINCT FROM v_img2 THEN
    RAISE EXCEPTION 'TEST FAILED (5): the stored row changed although the UPDATE was refused';
  END IF;

  -- ===== ARM 6 - the table OWNER cannot DELETE a reading directly (D-14, D-20(c)) ====
  -- A DELETE statement issued against the table runs the trigger at trigger depth 1 and is
  -- refused; the row is still there afterwards. (The cascade, which runs it nested, is arms 7a
  -- and 7b.) Seeded by the owner so this arm leans on no earlier arm.
  -- RED-UNDER: change the trigger's depth test in 20261117120000 from "greater than one" to
  --            "one or more". Every DELETE, direct ones included, is then admitted, and the
  --            table is write-once only against UPDATE.
-- RED-UNDER-M: {"arm":"6","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"pg_trigger_depth() > 1","replace":"pg_trigger_depth() >= 1","occurrences":1}]}
  v_u := pg_temp.sc_user();
  v_k := pg_temp.sc_key(v_u);
  v_out := pg_temp.sc_try(pg_temp.sc_row(v_k, 'mismatch'));
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (6): the owner INSERT of a legitimate row answered %, expected it to be accepted', v_out;
  END IF;
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM public.mt5_server_clock_readings WHERE api_key_id = v_k;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '23514' OR v_msg NOT LIKE 'mt5_server_clock_readings is write-once: a stored reading is never deleted directly%' THEN
    RAISE EXCEPTION 'TEST FAILED (6): an owner DELETE of a stored reading answered % (%), expected the trigger''s 23514 write-once refusal', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the delete ran');
  END IF;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_k;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (6): % row(s) remain for the key after the refused direct DELETE, expected 1', v_n;
  END IF;

  -- ===== ARM 7a - a soft disconnect keeps the readings; a key delete erases them ====
  -- (D-16, D-20(c), T-155.1-15.) Setting api_keys.disconnected_at (the soft disconnect) touches
  -- no reading row, and the readings are checked still present BEFORE the key is deleted. The
  -- soft-disconnect half lives here on purpose: no migration edit can make an api_keys column
  -- update reach these rows, so a separate arm for it could never bite, and a vacuous arm is
  -- worse than none. Then delete_allocator_api_key(key, false), called as the owning user
  -- under SET LOCAL ROLE authenticated with request.jwt.claims set, deletes the key, and the
  -- foreign key cascade erases that key's readings through the trigger at depth 2. A third
  -- key's reading stays. A trigger error on the cascade is trapped and reported as this arm's
  -- failure with its SQLSTATE.
  -- RED-UNDER: change the trigger's depth test in 20261117120000 from "greater than one" to
  --            "greater than ninety-nine", so no cascade is ever admitted. Deleting a key
  --            that has readings is then refused (23514) and a user can no longer remove
  --            their own connection: the trigger blocks key deletion.
-- RED-UNDER-M: {"arm":"7a","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"pg_trigger_depth() > 1","replace":"pg_trigger_depth() > 99","occurrences":1}]}
  v_a := pg_temp.sc_user();
  v_c := pg_temp.sc_user();
  v_ka := pg_temp.sc_key(v_a);
  v_kc := pg_temp.sc_key(v_c);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.sc_try(pg_temp.sc_row(v_ka, 'match'));
  IF v_out = 'OK' THEN v_out := pg_temp.sc_try(pg_temp.sc_row(v_ka, 'unmeasured', 'no_tick')); END IF;
  IF v_out = 'OK' THEN v_out := pg_temp.sc_try(pg_temp.sc_row(v_kc, 'match')); END IF;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id IN (v_ka, v_kc);
  IF v_out <> 'OK' OR v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (7a): the seed stored % row(s) (%), expected 3', v_n, v_out;
  END IF;
  UPDATE public.api_keys SET disconnected_at = now() WHERE id = v_ka;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_ka AND disconnected_at IS NOT NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (7a): the soft disconnect did not mark the key, so the keep-data half was not exercised';
  END IF;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_ka;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (7a): a soft disconnect left % of the key''s 2 readings, expected both to be kept', v_n;
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
    RAISE EXCEPTION 'TEST FAILED (7a): deleting the key raised % (%); a key with stored readings must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (7a): the key was not deleted, so the cascade was not exercised';
  END IF;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (7a): % reading(s) outlived their key', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_kc;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (7a): deleting one key left % of another key''s 1 reading, expected 1', v_n;
  END IF;

  -- ===== ARM 7b - an erased account erases its key's readings (D-20(c), T-155.1-15) ====
  -- The second erasure path, one table: DELETE FROM auth.users takes the user's key and, with
  -- it, the key's readings, with NO signed-in caller (request.jwt.claims is cleared), the way
  -- an operator-run erasure runs. A third user's reading must still be there afterwards.
  -- RED-UNDER: admit the cascade in 20261117120000 only for a signed-in caller (the depth test
  --            ANDed with auth.uid() IS NOT NULL). Arm 7a, which runs signed in, still passes;
  --            an account erasure with no signed-in user is then refused, and the account
  --            cannot be deleted while it has a reading.
-- RED-UNDER-M: {"arm":"7b","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"pg_trigger_depth() > 1","replace":"pg_trigger_depth() > 1 AND auth.uid() IS NOT NULL","occurrences":1}]}
  v_b := pg_temp.sc_user();
  v_c := pg_temp.sc_user();
  v_kb := pg_temp.sc_key(v_b);
  v_kc := pg_temp.sc_key(v_c);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.sc_try(pg_temp.sc_row(v_kb, 'match'));
  IF v_out = 'OK' THEN v_out := pg_temp.sc_try(pg_temp.sc_row(v_kc, 'match')); END IF;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id IN (v_kb, v_kc);
  IF v_out <> 'OK' OR v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (7b): the seed stored % row(s) (%), expected 2', v_n, v_out;
  END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM auth.users WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (7b): deleting the auth user raised % (%); an account with stored readings must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_kb;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (7b): % reading(s) outlived their account', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_kc;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (7b): another user''s reading was erased along with an unrelated account (% left, expected 1)', v_n;
  END IF;

  -- ===== ARM 8 - job_id carries no foreign key (D-16, SC-2) ===================
  -- compute_jobs rows expire, and a reading must outlive the job that took it. A reading
  -- carries the id of a real compute_jobs row; deleting that row leaves the reading, and the
  -- catalogue shows no foreign key from the table to compute_jobs (the api_keys key is the
  -- only one).
  -- RED-UNDER: give job_id a REFERENCES public.compute_jobs(id) ON DELETE CASCADE in
  --            20261117120000. Deleting the job row then erases the reading it took, and the
  --            evidence expires with the queue.
-- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"  job_id              UUID,","replace":"  job_id              UUID REFERENCES public.compute_jobs(id) ON DELETE CASCADE,","occurrences":1}]}
  v_u := pg_temp.sc_user();
  v_k := pg_temp.sc_key(v_u);
  v_job := gen_random_uuid();
  INSERT INTO public.compute_jobs (id, kind, api_key_id, status)
  VALUES (v_job, 'poll_allocator_positions', v_k, 'pending');
  v_out := pg_temp.sc_try(pg_temp.sc_row(v_k, 'match') || jsonb_build_object('job_id', v_job));
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (8): the owner INSERT of a reading carrying a job id answered %, expected it to be accepted', v_out;
  END IF;
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM public.compute_jobs WHERE id = v_job;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (8): deleting the compute_jobs row raised % (%); a reading must not hold the job row', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_jobs WHERE id = v_job;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (8): the compute_jobs row was not deleted, so the no-foreign-key claim was not exercised';
  END IF;
  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = v_k AND job_id = v_job;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (8): % reading(s) carrying the deleted job id remain, expected 1', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c
   WHERE c.conrelid = v_oid AND c.contype = 'f' AND c.confrelid = 'public.compute_jobs'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (8): % foreign key(s) from the table to compute_jobs exist, expected none (job_id outlives the job)', v_n;
  END IF;

  -- ===== ARM 9a - catalogue: row level security and privileges (D-15) =========
  -- RED-UNDER: drop the FORCE statement from 20261117120000 (ALTER TABLE ... NO FORCE ROW
  --            LEVEL SECURITY is the machine form). Every role the other arms use is a
  --            non-owner or BYPASSRLS, so they all still pass; only the catalogue sees that
  --            the table owner is no longer bound by the (empty) policy set.
-- RED-UNDER-M: {"arm":"9a","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"ALTER TABLE public.mt5_server_clock_readings FORCE ROW LEVEL SECURITY;\n","replace":"ALTER TABLE public.mt5_server_clock_readings NO FORCE ROW LEVEL SECURITY;\n","occurrences":1}]}
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v_oid AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'TEST FAILED (9a): row level security is not both enabled and forced on mt5_server_clock_readings';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policy p WHERE p.polrelid = v_oid;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (9a): % policies exist on mt5_server_clock_readings, expected none (service-role only by design)', v_n;
  END IF;
  FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      v_want := (v_role = 'service_role' AND v_priv IN ('SELECT', 'INSERT'));
      v_got := has_table_privilege(v_role, 'public.mt5_server_clock_readings', v_priv);
      IF v_got IS DISTINCT FROM v_want THEN
        RAISE EXCEPTION 'TEST FAILED (9a): % % on mt5_server_clock_readings is %, expected %', v_role, v_priv, v_got, v_want;
      END IF;
    END LOOP;
  END LOOP;

  -- ===== ARM 9b - catalogue: the trigger's shape (D-14) =======================
  -- tgtype is compared for EQUALITY with 27 = ROW (1) + BEFORE (2) + DELETE (8) + UPDATE (16),
  -- so a trigger that gained INSERT or TRUNCATE, lost UPDATE or DELETE, became AFTER or
  -- INSTEAD OF, or went statement-level, all fail it. A narrowed trigger would satisfy a
  -- mask test on every remaining bit, which is why this is not a mask.
  -- RED-UNDER: make the trigger FOR EACH STATEMENT in 20261117120000. The behaviour arms
  --            (5, 6, 7a, 7b) still pass, because a statement trigger refuses and admits on
  --            the same TG_OP and trigger depth, and only the catalogue sees that the
  --            trigger no longer runs once per row.
-- RED-UNDER-M: {"arm":"9b","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"  FOR EACH ROW\n  EXECUTE FUNCTION public.enforce_mt5_server_clock_readings_write_once();","replace":"  FOR EACH STATEMENT\n  EXECUTE FUNCTION public.enforce_mt5_server_clock_readings_write_once();","occurrences":1}]}
  SELECT count(*) INTO v_n FROM pg_trigger t WHERE t.tgrelid = v_oid AND NOT t.tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (9b): % non-internal trigger(s) on mt5_server_clock_readings, expected exactly the write-once trigger', v_n;
  END IF;
  SELECT t.tgname, t.tgenabled, t.tgtype, p.proname INTO v_trg
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = v_oid AND NOT t.tgisinternal;
  IF v_trg.tgname IS DISTINCT FROM 'mt5_server_clock_readings_write_once' THEN
    RAISE EXCEPTION 'TEST FAILED (9b): the trigger on mt5_server_clock_readings is %, expected mt5_server_clock_readings_write_once', v_trg.tgname;
  END IF;
  IF v_trg.tgenabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'TEST FAILED (9b): the write-once trigger is not enabled (tgenabled %)', v_trg.tgenabled;
  END IF;
  IF v_trg.tgtype IS DISTINCT FROM 27 THEN
    RAISE EXCEPTION 'TEST FAILED (9b): the write-once trigger has tgtype %, expected 27 (BEFORE UPDATE OR DELETE, FOR EACH ROW)', v_trg.tgtype;
  END IF;
  IF v_trg.proname IS DISTINCT FROM 'enforce_mt5_server_clock_readings_write_once' THEN
    RAISE EXCEPTION 'TEST FAILED (9b): the write-once trigger runs %, expected enforce_mt5_server_clock_readings_write_once', v_trg.proname;
  END IF;

  -- ===== ARM 9c - catalogue: the trigger function is not SECURITY DEFINER (T-155.1-17) ====
  -- RED-UNDER: make the trigger function SECURITY DEFINER in 20261117120000. It reads no
  --            table so nothing about its behaviour changes, but it would run with its
  --            owner's rights, and only the catalogue sees it.
-- RED-UNDER-M: {"arm":"9c","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"LANGUAGE plpgsql\n  SECURITY INVOKER","replace":"LANGUAGE plpgsql\n  SECURITY DEFINER","occurrences":1}]}
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = 'public.enforce_mt5_server_clock_readings_write_once()'::regprocedure
                    AND NOT p.prosecdef) THEN
    RAISE EXCEPTION 'TEST FAILED (9c): the write-once trigger function is SECURITY DEFINER, expected SECURITY INVOKER';
  END IF;

  -- ===== ARM 9d - catalogue: EXECUTE on the trigger function (T-155.1-17) ======
  -- RED-UNDER: drop anon and authenticated from the function's REVOKE in 20261117120000.
  --            The bootstrap default privileges then leave both roles EXECUTE on it. A
  --            trigger function is checked at CREATE TRIGGER, not when it fires, so no
  --            behaviour arm sees the grant.
-- RED-UNDER-M: {"arm":"9d","apply":[{"kind":"edit","file":"supabase/migrations/20261117120000_mt5_server_clock_readings.sql","find":"FROM PUBLIC, anon, authenticated;","replace":"FROM PUBLIC;","occurrences":1}]}
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.enforce_mt5_server_clock_readings_write_once()', 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST FAILED (9d): % may EXECUTE the write-once trigger function, expected it revoked', v_role;
    END IF;
  END LOOP;

  RAISE NOTICE 'ALL 24 ARMS EXECUTED (1, 2, 3a, 3b, 3c, 3d, 3e, 3f, 3g, 3h, 3i, 3j, 4a, 4b, 4c, 5, 6, 7a, 7b, 8, 9a, 9b, 9c, 9d): anon and authenticated are refused SELECT and INSERT by the privilege itself (1), service_role stores every verdict and reason shape (2), every value rule names its own constraint (3a-3j), service_role cannot UPDATE (4a), DELETE (4b) or TRUNCATE (4c), the table owner cannot UPDATE (5) or directly DELETE (6) a reading, a soft disconnect keeps the readings while a key delete (7a) and an account delete (7b) erase them and an unrelated reading stays, job_id holds no foreign key (8), row level security is enabled and forced with the exact privilege matrix (9a), the trigger is BEFORE UPDATE OR DELETE FOR EACH ROW (9b), not SECURITY DEFINER (9c) and not executable by anon or authenticated (9d).';
END $$;

ROLLBACK;
