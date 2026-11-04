-- Test: public.mark_compute_job_kept_figures and public.retract_ledger_refresh_marker.
-- Phase 191 REFUSALRACE, plan 03 (SC-3, D-04, D-09). Guards migration
-- 20261106120000_refusalrace_metadata_merge_rpcs.sql.
--
-- Background
-- ----------
-- Two writers used to change `compute_jobs.metadata` by reading the whole object,
-- editing one key and writing the whole object back: the derive's refusal marker
-- (`read_refusal_kept_figures`) and a Sync's retraction of an inherited ledger-refresh
-- marker (`source` -> `refresh_marker_retracted`). PostgREST replaces the column, so
-- whichever write landed between the other's read and write was undone. The migration
-- moves each write into ONE UPDATE that merges into the column. This file proves, in
-- SQL, that the merged result keeps every key when the writers run one after another in
-- either order (arms 9 and 10), that neither function reads compute_jobs before its
-- UPDATE (arms 12 and 13), and that each property can fail. It does NOT prove concurrency: one
-- session cannot interleave two statements, so arms 9 and 10 are green on a
-- read-then-replace body too. The concurrency proof is the live two-connection probe
-- (plan 191-09, PR 2).
--
-- Keys used below: S = source, C = correlation_id, P = member_progress,
-- U = unified_backbone_at_claim, K = read_refusal_kept_figures,
-- R = refresh_marker_retracted.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each
-- twin's FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend on
-- arms listed before it):
--   1  the marker function: SECURITY DEFINER, search_path public, pg_catalog,
--      service_role EXECUTE, anon / authenticated / PUBLIC none.
--   2  the same for the retraction function.
--   3  the marker keeps S, C and P with their values, sets K, returns true.
--   4  the marker on NULL, JSON null, array and scalar metadata leaves exactly
--      {K: true}; on an unknown id it returns false.
--   5  the retraction of each marker returns `retracted`: S gone, R holds the old
--      marker, C holds the new id (JSON null for a NULL id), P kept.
--   6  not a marker (other source, NULL, array, no `source`): `no_marker`, row untouched.
--   7  a `done` row is never retracted (`done`, with its marker or a null one); every
--      other status is.
--   8  an unknown id and a NULL id: `no_row`.
--   9  two writers, SEQUENTIAL: marker and retraction in both orders end with EQUAL
--      metadata (key preservation and commutation; not concurrency).
--   10 three writers, SEQUENTIAL: all six orders of {marker, retraction, claim-style write}
--      end with EQUAL metadata holding K, U, R, the new C and P, and no S.
--   11 illustration (untwinned): a read-then-replace written in this test loses R and
--      brings S back, so the assertion style of arms 9 and 10 can detect a missing key.
--      It says nothing about the two functions. Raises `ARM 11 FAILED (control)`, not
--      `TEST FAILED`: it has no twin (see arm 11).
--   12 the marker's single-statement shape: from its comment-stripped definition, it
--      mentions compute_jobs exactly once and that mention is its UPDATE. A body that
--      reads the row first (`SELECT metadata INTO v ...; UPDATE ... SET metadata = v
--      || ...`) is the racy shape and fails here, which arms 9 and 10 cannot see.
--   13 the retraction's single-statement shape: from its comment-stripped definition,
--      it mentions compute_jobs exactly twice: its UPDATE first, then the classifying
--      SELECT after `IF FOUND THEN` that reports why nothing matched.
--
-- Every identity carries a digit. Every `TEST FAILED (N)` raise sits DIRECTLY in the
-- DO body (the mutation runner reads an identity only from a single-frame
-- `inline_code_block` raise); the pg_temp helpers return values and never raise an
-- identity.
--
-- The claim-style write used by the three-writer arm is the claim RPC's own merge
-- expression copied into this file, not a call to the claim RPC (D-09).
--
-- Inside this file's single transaction `now()` is frozen, so `updated_at` cannot show
-- that a write happened. "Unchanged" is asserted with the row's `ctid` plus its
-- metadata before and after: any UPDATE writes a new tuple version and moves `ctid`.
--
-- Lanes. It runs on the pg-lane (the mutation runner's lane, with the setup list below)
-- and on the local-stack lane that CI's `sql-tests` runs (the committed dump plus the
-- D-F replay of the migration). Seeds are one auth user, profile, strategy and job per
-- row (one in-flight job per strategy and kind); ids are gen_random_uuid() and emails
-- end in @invalid.local. The file creates no table and updates no strategy_analytics
-- row. The whole file is BEGIN ... ROLLBACK.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure, no psql meta-commands.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_compute_job_metadata_merge.sql
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm that exercises the migration carries a prose
-- `RED-UNDER:` and a machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE the arm reds on its own, then restores GREEN.
-- Schema: scripts/mutation-runner/GRAMMAR.md. The migration's own verify block pins the
-- ACL during the apply, so the two ACL arms' twins are post-apply `sql` GRANTs (an `edit`
-- widening the GRANT would abort the apply and the gate would never run); every other
-- twin edits the one migration.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql"]}

BEGIN;

-- Seeds one auth user, profile, strategy and compute_jobs row in the given status with
-- the given metadata (SQL NULL stays NULL; 'null'::jsonb is a JSON null). Returns the
-- job id. pg_temp functions live and die with this transaction and carry no arm.
CREATE FUNCTION pg_temp.mc_job(p_status text, p_meta jsonb) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_strat uuid;
  v_job   uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'mc-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'mc') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'mc-strat') RETURNING id INTO v_strat;
  INSERT INTO public.compute_jobs (id, kind, strategy_id, status, metadata)
    VALUES (v_job, 'compute_analytics', v_strat, p_status, p_meta);
  RETURN v_job;
END
$f$;

-- The metadata of one job.
CREATE FUNCTION pg_temp.mc_meta(p_job uuid) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT metadata FROM public.compute_jobs WHERE id = p_job
$f$;


-- The physical tuple id of one job. Any UPDATE writes a new tuple version, so an
-- unchanged ctid plus unchanged metadata proves a statement wrote nothing.
CREATE FUNCTION pg_temp.mc_ctid(p_job uuid) RETURNS text
LANGUAGE sql AS $f$
  SELECT ctid::text FROM public.compute_jobs WHERE id = p_job
$f$;

DO $$
DECLARE
  v_oid    oid;
  v_cfg    text[];
  v_secdef boolean;
  v_id     uuid;
  v_a      uuid;
  v_b      uuid;
  v_m      jsonb;
  v_ma     jsonb;
  v_mb     jsonb;
  v_first  jsonb;
  v_want   jsonb;
  v_prog   jsonb;
  v_seed   jsonb;
  v_case   jsonb;
  v_ok     boolean;
  v_out    jsonb;
  v_n      integer;
  v_i      integer;
  v_marker text;
  v_status text;
  v_order  text;
  v_step   text;
  v_ctid0  text;
  v_meta0  jsonb;
  v_flag   boolean := true;
  v_src    text;
BEGIN
  v_prog := jsonb_build_array(jsonb_build_object('seq', 1, 'status', 'in_process'));
  v_seed := jsonb_build_object('source', 'ledger-refresh', 'correlation_id', 'old',
                               'member_progress', v_prog);

  -- ===== ARM 1 - the marker function's ACL and hardening ======================
  -- Absence is an EXCEPTION, never a skip: merging supabase/migrations/** applies to
  -- PRODUCTION with no human stop.
  -- RED-UNDER: on the live database, after the migration (and its own catalogue verify)
  --            has applied, GRANT EXECUTE on mark_compute_job_kept_figures(uuid) TO
  --            authenticated: a SECURITY DEFINER writer of compute_jobs.metadata becomes
  --            callable through PostgREST by any signed-in user. A post-apply `sql`
  --            step, because an edit widening the GRANT would trip the migration's own
  --            verify block during the apply and the gate would never run.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.mark_compute_job_kept_figures(uuid) TO authenticated"}]}
  v_oid := to_regprocedure('public.mark_compute_job_kept_figures(uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): public.mark_compute_job_kept_figures(uuid) does not exist - this gate has nothing to test and must not skip';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (1): mark_compute_job_kept_figures is not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog') THEN
    RAISE EXCEPTION 'TEST FAILED (1): mark_compute_job_kept_figures does not pin search_path to public, pg_catalog';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (1): service_role lacks EXECUTE on mark_compute_job_kept_figures - the worker cannot call it';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (1): anon can EXECUTE mark_compute_job_kept_figures';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (1): authenticated can EXECUTE mark_compute_job_kept_figures';
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (1): PUBLIC still holds EXECUTE on mark_compute_job_kept_figures';
  END IF;

  -- ===== ARM 2 - the retraction function's ACL and hardening =================
  -- RED-UNDER: the same on retract_ledger_refresh_marker(uuid, text): after the
  --            migration has applied, GRANT EXECUTE TO authenticated. A post-apply `sql`
  --            step for the same reason as arm 1.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.retract_ledger_refresh_marker(uuid, text) TO authenticated"}]}
  v_oid := to_regprocedure('public.retract_ledger_refresh_marker(uuid,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2): public.retract_ledger_refresh_marker(uuid, text) does not exist - this gate has nothing to test and must not skip';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (2): retract_ledger_refresh_marker is not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog') THEN
    RAISE EXCEPTION 'TEST FAILED (2): retract_ledger_refresh_marker does not pin search_path to public, pg_catalog';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (2): service_role lacks EXECUTE on retract_ledger_refresh_marker - the routes cannot call it';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (2): anon can EXECUTE retract_ledger_refresh_marker';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (2): authenticated can EXECUTE retract_ledger_refresh_marker';
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (2): PUBLIC still holds EXECUTE on retract_ledger_refresh_marker';
  END IF;

  -- ===== ARM 3 - the marker keeps every other key ============================
  -- The row carries S, C and P only (never K or U), so the later arms' twins that
  -- delete K or U cannot reach this arm.
  -- RED-UNDER: in the marker's UPDATE, drop the left operand of the merge: SET metadata
  --            to the bare `jsonb_build_object('read_refusal_kept_figures', true)`.
  --            The marker is still written and the function still returns true, but S,
  --            C and P are wiped, which is the lost update from the other side. The ACL
  --            arms are untouched.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"CASE WHEN jsonb_typeof(metadata) = 'object'\n                         THEN metadata\n                         ELSE '{}'::jsonb\n                    END\n                    || jsonb_build_object('read_refusal_kept_figures', true)","replace":"jsonb_build_object('read_refusal_kept_figures', true)","occurrences":1}]}
  v_id := pg_temp.mc_job('pending', v_seed);
  v_ok := public.mark_compute_job_kept_figures(v_id);
  IF v_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (3): the marker returned % on an existing row (expected true)', v_ok;
  END IF;
  v_m := pg_temp.mc_meta(v_id);
  IF v_m -> 'read_refusal_kept_figures' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (3): the marker did not set read_refusal_kept_figures to JSON true (got %)', v_m;
  END IF;
  IF v_m ->> 'source' IS DISTINCT FROM 'ledger-refresh'
     OR v_m ->> 'correlation_id' IS DISTINCT FROM 'old'
     OR v_m -> 'member_progress' IS DISTINCT FROM v_prog THEN
    RAISE EXCEPTION 'TEST FAILED (3): the marker clobbered a key it does not own (got %)', v_m;
  END IF;

  -- ===== ARM 4 - the marker on metadata that is not an object ================
  -- RED-UNDER: replace the marker's `jsonb_typeof` guard (the CASE that turns non-object
  --            metadata into a fresh object) with bare `metadata`. NULL || object is NULL
  --            and array || object is an array, so the marker is silently lost or
  --            malformed on exactly the rows the Python writer used to repair. The
  --            object case of arm 3 still passes, so this arm is the first failure.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"CASE WHEN jsonb_typeof(metadata) = 'object'\n                         THEN metadata\n                         ELSE '{}'::jsonb\n                    END","replace":"metadata","occurrences":1}]}
  v_want := jsonb_build_object('read_refusal_kept_figures', true);
  v_i := 0;
  FOREACH v_case IN ARRAY ARRAY[NULL::jsonb, 'null'::jsonb, '[1,2]'::jsonb, '"text"'::jsonb, '7'::jsonb] LOOP
    v_i := v_i + 1;
    v_id := pg_temp.mc_job('pending', v_case);
    v_ok := public.mark_compute_job_kept_figures(v_id);
    IF v_ok IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'TEST FAILED (4): the marker returned % on non-object metadata case % (expected true)', v_ok, v_i;
    END IF;
    v_m := pg_temp.mc_meta(v_id);
    IF v_m IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION 'TEST FAILED (4): non-object metadata case % ended as %, expected exactly the marker object', v_i, v_m;
    END IF;
  END LOOP;
  v_id := gen_random_uuid();
  v_ok := public.mark_compute_job_kept_figures(v_id);
  IF v_ok IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (4): the marker returned % for an unknown id (expected false)', v_ok;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_jobs WHERE id = v_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (4): the marker created a row for an unknown id';
  END IF;

  -- ===== ARM 5 - the retraction of each marker ===============================
  -- Seeds carry S, C and P only (never K or U).
  -- RED-UNDER: narrow the FIRST marker list in the retraction (the UPDATE's WHERE
  --            clause, `nth` 1 of two) to ('ledger-refresh'). The composite marker no
  --            longer matches the UPDATE, so a Sync's composite refresh stays protected
  --            and the function reports `no_marker`. Arms 1 to 4 do not call the
  --            retraction, so this is the first failure.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"IN ('ledger-refresh', 'ledger-refresh-composite')","replace":"IN ('ledger-refresh')","occurrences":2,"nth":1}]}
  FOREACH v_marker IN ARRAY ARRAY['ledger-refresh', 'ledger-refresh-composite'] LOOP
    v_id := pg_temp.mc_job('running',
              jsonb_build_object('source', v_marker, 'correlation_id', 'old',
                                 'member_progress', v_prog));
    v_out := public.retract_ledger_refresh_marker(v_id, 'new');
    IF v_out ->> 'outcome' IS DISTINCT FROM 'retracted' OR v_out ->> 'marker' IS DISTINCT FROM v_marker THEN
      RAISE EXCEPTION 'TEST FAILED (5): retracting marker % returned % (expected retracted with that marker)', v_marker, v_out;
    END IF;
    v_m := pg_temp.mc_meta(v_id);
    IF v_m ? 'source' THEN
      RAISE EXCEPTION 'TEST FAILED (5): the % marker is still on the row after the retraction (got %)', v_marker, v_m;
    END IF;
    IF v_m ->> 'refresh_marker_retracted' IS DISTINCT FROM v_marker
       OR v_m ->> 'correlation_id' IS DISTINCT FROM 'new'
       OR v_m -> 'member_progress' IS DISTINCT FROM v_prog THEN
      RAISE EXCEPTION 'TEST FAILED (5): retracting % wrote the wrong keys (got %)', v_marker, v_m;
    END IF;
  END LOOP;
  v_id := pg_temp.mc_job('pending', v_seed);
  v_out := public.retract_ledger_refresh_marker(v_id, NULL);
  IF v_out ->> 'outcome' IS DISTINCT FROM 'retracted' THEN
    RAISE EXCEPTION 'TEST FAILED (5): retraction with a NULL correlation id returned % (expected retracted)', v_out;
  END IF;
  v_m := pg_temp.mc_meta(v_id);
  IF NOT (v_m ? 'correlation_id') OR jsonb_typeof(v_m -> 'correlation_id') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'TEST FAILED (5): a NULL correlation id must be written as JSON null (got %)', v_m;
  END IF;

  -- ===== ARM 6 - a row that is not a marker is left alone ====================
  -- RED-UNDER: delete the retraction's marker predicate (the UPDATE's
  --            `AND (metadata ->> 'source') IN (...)` line, replaced with `AND TRUE`). Every
  --            non-done row is then "retracted": a wizard job loses its `source` and gains
  --            R and C. Arm 5's marker rows still pass, so only a row that is not a
  --            marker can see it.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"     AND (metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')","replace":"     AND TRUE","occurrences":1}]}
  v_i := 0;
  FOREACH v_case IN ARRAY ARRAY[
      jsonb_build_object('source', 'wizard', 'correlation_id', 'c'),
      NULL::jsonb,
      '["ledger-refresh"]'::jsonb,
      jsonb_build_object('correlation_id', 'c')] LOOP
    v_i := v_i + 1;
    v_id := pg_temp.mc_job('pending', v_case);
    v_ctid0 := pg_temp.mc_ctid(v_id);
    v_meta0 := pg_temp.mc_meta(v_id);
    v_out := public.retract_ledger_refresh_marker(v_id, 'new');
    IF v_out ->> 'outcome' IS DISTINCT FROM 'no_marker' THEN
      RAISE EXCEPTION 'TEST FAILED (6): not-a-marker case % returned % (expected no_marker)', v_i, v_out;
    END IF;
    IF pg_temp.mc_ctid(v_id) IS DISTINCT FROM v_ctid0
       OR pg_temp.mc_meta(v_id) IS DISTINCT FROM v_meta0 THEN
      RAISE EXCEPTION 'TEST FAILED (6): not-a-marker case % was written (metadata now %)', v_i, pg_temp.mc_meta(v_id);
    END IF;
  END LOOP;

  -- ===== ARM 7 - a done row is never retracted ===============================
  -- RED-UNDER: delete `AND status <> 'done'` from the retraction's UPDATE (replaced with
  --            `AND TRUE`). A job that already finished has its marker stripped after
  --            the fact. Arms 5 and 6 use pending and running rows, so only the done
  --            rows can see it.
  -- RED-UNDER-M: {"arm":"7","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"     AND status <> 'done'","replace":"     AND TRUE","occurrences":1}]}
  FOREACH v_marker IN ARRAY ARRAY['ledger-refresh', 'ledger-refresh-composite'] LOOP
    v_id := pg_temp.mc_job('done',
              jsonb_build_object('source', v_marker, 'correlation_id', 'old'));
    v_ctid0 := pg_temp.mc_ctid(v_id);
    v_meta0 := pg_temp.mc_meta(v_id);
    v_out := public.retract_ledger_refresh_marker(v_id, 'new');
    IF v_out ->> 'outcome' IS DISTINCT FROM 'done' OR v_out ->> 'marker' IS DISTINCT FROM v_marker THEN
      RAISE EXCEPTION 'TEST FAILED (7): a done row carrying % returned % (expected done with that marker)', v_marker, v_out;
    END IF;
    IF pg_temp.mc_ctid(v_id) IS DISTINCT FROM v_ctid0
       OR pg_temp.mc_meta(v_id) IS DISTINCT FROM v_meta0 THEN
      RAISE EXCEPTION 'TEST FAILED (7): a done row carrying % was written (metadata now %)', v_marker, pg_temp.mc_meta(v_id);
    END IF;
  END LOOP;
  v_id := pg_temp.mc_job('done', jsonb_build_object('source', 'wizard'));
  v_out := public.retract_ledger_refresh_marker(v_id, 'new');
  IF v_out ->> 'outcome' IS DISTINCT FROM 'done' OR v_out ->> 'marker' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (7): a done row without a marker returned % (expected done with a null marker)', v_out;
  END IF;
  FOREACH v_status IN ARRAY ARRAY['pending', 'running', 'done_pending_children', 'failed_retry', 'failed_final'] LOOP
    v_id := pg_temp.mc_job(v_status, jsonb_build_object('source', 'ledger-refresh', 'correlation_id', 'old'));
    v_out := public.retract_ledger_refresh_marker(v_id, 'new');
    IF v_out ->> 'outcome' IS DISTINCT FROM 'retracted' THEN
      RAISE EXCEPTION 'TEST FAILED (7): a % row carrying a marker returned % (expected retracted)', v_status, v_out;
    END IF;
  END LOOP;

  -- ===== ARM 8 - a missing row ===============================================
  -- RED-UNDER: change the `no_row` outcome literal to `no_marker`. A caller then cannot
  --            tell a job that vanished from a job that was never a refresh. Arms 5 to 7
  --            find their rows, so none of them reaches this literal.
  -- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"'outcome', 'no_row'","replace":"'outcome', 'no_marker'","occurrences":1}]}
  v_out := public.retract_ledger_refresh_marker(gen_random_uuid(), 'new');
  IF v_out ->> 'outcome' IS DISTINCT FROM 'no_row' THEN
    RAISE EXCEPTION 'TEST FAILED (8): an unknown id returned % (expected no_row)', v_out;
  END IF;
  v_out := public.retract_ledger_refresh_marker(NULL, 'new');
  IF v_out ->> 'outcome' IS DISTINCT FROM 'no_row' THEN
    RAISE EXCEPTION 'TEST FAILED (8): a NULL id returned % (expected no_row)', v_out;
  END IF;

  -- ===== ARM 9 - the marker and the retraction, sequentially, in both orders ==
  -- Two rows start with S, C and P. Row A takes the marker and then the retraction; row
  -- B the retraction and then the marker. Both must end with the SAME metadata: K true,
  -- R holding the old marker, the new C, P kept, and no S. The calls run one after
  -- another in one session, so this proves the two merges keep each other's keys and
  -- commute. It does NOT reproduce the lost update: a read-then-replace body passes it
  -- too. Arm 12 pins the single-statement shape and plan 191-09's two-connection probe
  -- is the concurrency proof.
  -- RED-UNDER: in the retraction's UPDATE, change `SET metadata = (metadata - 'source')`
  --            to also drop K: `(metadata - 'source' - 'read_refusal_kept_figures')`.
  --            The retraction then undoes a marker written before it (row A), the very
  --            lost update, while the retraction-first order (row B) still ends with K,
  --            so only the interleave sees it. Arms 3 to 8 seed no K, so none of them
  --            can notice.
  -- RED-UNDER-M: {"arm":"9","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"(metadata - 'source')","replace":"(metadata - 'source' - 'read_refusal_kept_figures')","occurrences":1}]}
  v_want := jsonb_build_object('read_refusal_kept_figures', true,
                               'refresh_marker_retracted', 'ledger-refresh',
                               'correlation_id', 'new',
                               'member_progress', v_prog);
  v_a := pg_temp.mc_job('pending', v_seed);
  v_b := pg_temp.mc_job('pending', v_seed);

  v_ok := public.mark_compute_job_kept_figures(v_a);
  IF v_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (9): marker on row A returned % (expected true)', v_ok;
  END IF;
  v_out := public.retract_ledger_refresh_marker(v_a, 'new');
  IF v_out ->> 'outcome' IS DISTINCT FROM 'retracted' THEN
    RAISE EXCEPTION 'TEST FAILED (9): retraction on row A returned % (expected retracted)', v_out;
  END IF;

  v_out := public.retract_ledger_refresh_marker(v_b, 'new');
  IF v_out ->> 'outcome' IS DISTINCT FROM 'retracted' THEN
    RAISE EXCEPTION 'TEST FAILED (9): retraction on row B returned % (expected retracted)', v_out;
  END IF;
  v_ok := public.mark_compute_job_kept_figures(v_b);
  IF v_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (9): marker on row B returned % (expected true)', v_ok;
  END IF;

  v_ma := pg_temp.mc_meta(v_a);
  v_mb := pg_temp.mc_meta(v_b);
  IF v_ma IS DISTINCT FROM v_mb THEN
    RAISE EXCEPTION 'TEST FAILED (9): the two write orders end differently: marker-first % vs retraction-first %', v_ma, v_mb;
  END IF;
  IF v_ma IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'TEST FAILED (9): the merged metadata lost or kept the wrong key: got %, expected %', v_ma, v_want;
  END IF;

  -- ===== ARM 10 - the marker, the retraction and a claim-style write, in sequence ==
  -- The claim-style write is a plain UPDATE using the merge expression copied from
  -- supabase/schema/functions/claim_compute_jobs_with_priority.sql (the
  -- `unified_backbone_at_claim` arm), with the live flag fixed to true. It is NOT a call
  -- to the claim RPC (D-09). All six orders of the three writers must end with the same
  -- metadata: K, U, R, the new C and P, and no S. Sequential, like arm 9: key
  -- preservation in every order, not concurrency.
  -- RED-UNDER: make the marker also drop U: `- 'unified_backbone_at_claim'` before its
  --            merge. Orders where the claim-style write lands before the marker then
  --            lose U, the claim snapshot the watchdog re-claim depends on. Arms 3 to 9
  --            seed no U, so none of them can notice.
  -- RED-UNDER-M: {"arm":"10","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"|| jsonb_build_object('read_refusal_kept_figures', true)","replace":"- 'unified_backbone_at_claim' || jsonb_build_object('read_refusal_kept_figures', true)","occurrences":1}]}
  v_want := jsonb_build_object('read_refusal_kept_figures', true,
                               'unified_backbone_at_claim', 'true',
                               'refresh_marker_retracted', 'ledger-refresh',
                               'correlation_id', 'new',
                               'member_progress', v_prog);
  v_first := NULL;
  FOREACH v_order IN ARRAY ARRAY['MRC', 'MCR', 'RMC', 'RCM', 'CMR', 'CRM'] LOOP
    v_id := pg_temp.mc_job('pending', v_seed);
    FOR v_i IN 1..3 LOOP
      v_step := substr(v_order, v_i, 1);
      IF v_step = 'M' THEN
        v_ok := public.mark_compute_job_kept_figures(v_id);
        IF v_ok IS DISTINCT FROM TRUE THEN
          RAISE EXCEPTION 'TEST FAILED (10): order %, step %: the marker returned % (expected true)', v_order, v_i, v_ok;
        END IF;
      ELSIF v_step = 'R' THEN
        v_out := public.retract_ledger_refresh_marker(v_id, 'new');
        IF v_out ->> 'outcome' IS DISTINCT FROM 'retracted' THEN
          RAISE EXCEPTION 'TEST FAILED (10): order %, step %: the retraction returned % (expected retracted)', v_order, v_i, v_out;
        END IF;
      ELSE
        UPDATE public.compute_jobs
           SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                 'unified_backbone_at_claim',
                 COALESCE(metadata->>'unified_backbone_at_claim',
                          CASE WHEN v_flag IS NULL THEN NULL
                               ELSE v_flag::text
                          END))
         WHERE id = v_id;
      END IF;
    END LOOP;
    v_m := pg_temp.mc_meta(v_id);
    IF v_first IS NULL THEN
      v_first := v_m;
    ELSIF v_m IS DISTINCT FROM v_first THEN
      RAISE EXCEPTION 'TEST FAILED (10): order % ends differently from order MRC: % vs %', v_order, v_m, v_first;
    END IF;
    IF v_m IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION 'TEST FAILED (10): order % lost or kept the wrong key: got %, expected %', v_order, v_m, v_want;
    END IF;
  END LOOP;

  -- ===== ARM 11 - illustration: a read-then-replace written here loses a key =====
  -- UNTWINNED on purpose. This arm writes the old read-then-replace sequence in the test
  -- itself: read the metadata, let the real retraction land, then write the stale copy
  -- plus K back. The retraction's R must be LOST and S must be BACK. That shows only
  -- that an assertion in the style of arms 9 and 10 (compare the whole metadata) can
  -- detect a missing key. The replace is hand-written here, so it loses R by
  -- construction and no change to the two functions can fail this arm: it proves nothing
  -- about them and does not make a green arm 9 or 10 mean "the merge" (arms 12 and 13 are the
  -- check on the functions' shape). It carries no RED-UNDER. It raises with
  -- the `ARM x FAILED` spelling, which the runner deliberately does not attribute: a
  -- `TEST FAILED (N)` identity here would be a section with no twin, which
  -- mutation-annotation-parser.test.ts refuses (set inclusion over sections). The raise
  -- still aborts the file under ON_ERROR_STOP, so a blind harness fails CI loudly.
  v_id := pg_temp.mc_job('pending', v_seed);
  v_meta0 := pg_temp.mc_meta(v_id);
  v_out := public.retract_ledger_refresh_marker(v_id, 'new');
  IF v_out ->> 'outcome' IS DISTINCT FROM 'retracted' THEN
    RAISE EXCEPTION 'ARM 11 FAILED (control): the control row was not retracted: %', v_out;
  END IF;
  UPDATE public.compute_jobs
     SET metadata = v_meta0 || jsonb_build_object('read_refusal_kept_figures', true)
   WHERE id = v_id;
  v_m := pg_temp.mc_meta(v_id);
  IF v_m ? 'refresh_marker_retracted'
     OR v_m ->> 'source' IS DISTINCT FROM 'ledger-refresh'
     OR v_m -> 'read_refusal_kept_figures' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'ARM 11 FAILED (control): the hand-written read-then-replace did NOT lose the retraction (got %): the whole-metadata comparison of arms 9 and 10 would not see a missing key', v_m;
  END IF;

  -- ===== ARM 12 - the marker touches compute_jobs only in its single UPDATE =====
  -- A write that cannot lose a concurrent update has no separate read: the SET
  -- expression merges into the row the UPDATE locks. A body that first reads the row
  -- (SELECT metadata INTO v, or PERFORM ... FROM compute_jobs) and writes from the copy
  -- is the racy shape, and arms 9 and 10 stay green on it because they never interleave.
  -- The definition is read through pg_get_functiondef with both comment syntaxes
  -- stripped in ONE left-to-right pass (whichever comment starts first owns its text, so
  -- a `--` inside a block comment cannot orphan the `/*`). PostgreSQL's nested block
  -- comments are not handled. The marker must mention compute_jobs exactly once,
  -- directly after `UPDATE public.`.
  -- RED-UNDER: in the marker, insert `PERFORM 1 FROM public.compute_jobs WHERE id =
  --            p_job_id;` before its UPDATE. The marker still returns the right values
  --            and keeps every key, so arms 1 to 11 stay green; the extra read is a
  --            second mention of compute_jobs and comes before the UPDATE, so only this
  --            arm sees it.
  -- RED-UNDER-M: {"arm":"12","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"BEGIN\n  UPDATE public.compute_jobs\n     SET metadata = CASE","replace":"BEGIN\n  PERFORM 1 FROM public.compute_jobs WHERE id = p_job_id;\n  UPDATE public.compute_jobs\n     SET metadata = CASE","occurrences":1}]}
  v_oid := to_regprocedure('public.mark_compute_job_kept_figures(uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (12): public.mark_compute_job_kept_figures(uuid) does not exist - this gate has nothing to test and must not skip';
  END IF;
  v_src := regexp_replace(pg_get_functiondef(v_oid), '--[^\n]*|/\*([^*]|\*+[^*/])*\*+/', '', 'g');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (12): the marker definition came back NULL, so every match below would pass without reading anything';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, 'compute_jobs', 'g');
  IF v_n <> 1 OR substr(v_src, strpos(v_src, 'compute_jobs') - 14, 14) IS DISTINCT FROM 'UPDATE public.' THEN
    RAISE EXCEPTION 'TEST FAILED (12): the marker mentions compute_jobs % time(s) and not only in its UPDATE: it reads the row before it writes', v_n;
  END IF;

  -- ===== ARM 13 - the retraction reads compute_jobs only in its UPDATE and its classifier =====
  -- Same reasoning as arm 12 for the other writer. The retraction legitimately reads
  -- compute_jobs AFTER its UPDATE (the classifying SELECT that says why nothing
  -- matched), so it has exactly two mentions: the first directly after `UPDATE public.`,
  -- the second after `IF FOUND THEN`. A third mention (a scalar subquery in SET, an
  -- UPDATE ... FROM self-join, a read before the UPDATE) reads a stale copy and fails.
  -- RED-UNDER: in the retraction, insert `PERFORM 1 FROM public.compute_jobs WHERE id =
  --            p_job_id;` before its UPDATE. The retraction still returns the right
  --            outcomes and keeps every key, so arms 1 to 12 stay green (arm 12 reads
  --            the marker only); the first mention of compute_jobs is now a read and
  --            the count is three, so only this arm sees it.
  -- RED-UNDER-M: {"arm":"13","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"  UPDATE public.compute_jobs\n     SET metadata = (metadata - 'source')","replace":"  PERFORM 1 FROM public.compute_jobs WHERE id = p_job_id;\n  UPDATE public.compute_jobs\n     SET metadata = (metadata - 'source')","occurrences":1}]}
  v_oid := to_regprocedure('public.retract_ledger_refresh_marker(uuid,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (13): public.retract_ledger_refresh_marker(uuid, text) does not exist - this gate has nothing to test and must not skip';
  END IF;
  v_src := regexp_replace(pg_get_functiondef(v_oid), '--[^\n]*|/\*([^*]|\*+[^*/])*\*+/', '', 'g');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (13): the retraction definition came back NULL, so the match below would pass without reading anything';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, 'compute_jobs', 'g');
  IF v_n <> 2
     OR substr(v_src, strpos(v_src, 'compute_jobs') - 14, 14) IS DISTINCT FROM 'UPDATE public.'
     OR strpos(v_src, 'IF FOUND THEN') = 0
     OR strpos(substr(v_src, strpos(v_src, 'IF FOUND THEN')), 'compute_jobs') = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (13): the retraction mentions compute_jobs % time(s) and not only in its UPDATE and its classifying SELECT: it reads the row outside the statement that writes it', v_n;
  END IF;

  RAISE NOTICE 'ALL 13 ARMS EXECUTED (1,2,3,4,5,6,7,8,9,10,11,12,13): the marker function is a hardened service-role-only definer (1), and so is the retraction (2), the marker keeps every other key (3) and repairs metadata that is not an object while an unknown id returns false (4), the retraction of each marker drops source and keeps the rest with a JSON null for a NULL correlation id (5), a row that is not a marker is untouched (6), a done row is never retracted (7), a missing row is no_row (8), the marker and the retraction, run one after another, end equal in both orders (9), all six sequential orders of marker, retraction and a claim-style write end equal with every key (10), a read-then-replace written in this test loses a key so a whole-metadata comparison can see one (11), the marker mentions compute_jobs only in its single UPDATE (12), and the retraction reads compute_jobs only in its UPDATE and its classifying SELECT (13). Concurrency itself is NOT proven here: that is the live two-connection probe.';
END $$;

ROLLBACK;
