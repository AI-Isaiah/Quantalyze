-- Test: public.set_compute_job_seed_hold(uuid, uuid, bigint).
-- Phase 257 SEEDHOLD, plan 02 (SC-1 enabling half, SC-5). Guards migration
-- 20261128120000_compute_job_seed_hold.sql.
--
-- Founder ruling 2026-11-28 (AskUserQuestion, recorded in 257-CONTEXT.md), verbatim
-- choice: "Job's private record (Recommended)". When the per-strategy re-read bound
-- cannot be written for a whole run, the run leaves its seed on its OWN
-- `compute_jobs.metadata` (service-role only, not anon-readable), and the next run reads
-- it back as a further seed term. This migration is the write side: a claim-token-fenced
-- merge of {seed_hold_ms: <epoch ms>} into the running job's metadata, in ONE UPDATE.
--
-- WHAT THIS FILE DOES NOT PROVE. Concurrency. One session cannot interleave two
-- statements, so arm 2 proves that the merge keeps every other key and arm 8 pins the
-- single-statement shape (a read-then-write body is the racy shape Phase 191 REFUSALRACE
-- removed, 20261106120000). The read-committed re-evaluation that makes one statement
-- enough is the property documented in that migration's header.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each
-- twin's FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend on
-- arms listed before it):
--   1  catalogue: the function exists, is SECURITY DEFINER, pins search_path to
--      public, pg_catalog; service_role holds EXECUTE; anon, authenticated and PUBLIC none.
--   2  merge: a running row with its token, called with that token and a value above the
--      int4 range, returns true, keeps every prior key and holds seed_hold_ms.
--   3  stale token: another uuid returns false; ctid and metadata unchanged.
--   4  NULL token: a running row with a NULLed token called with NULL returns false and is
--      unchanged; a running row with a token called with NULL returns false and is unchanged.
--   5  status: rows with the matching token in done, pending, failed_retry and
--      failed_final return false and are unchanged.
--   6  non-object metadata (SQL NULL, JSON null, array, scalar) ends as exactly
--      {seed_hold_ms: v}, returns true.
--   7  input guard: a NULL and a negative p_floor_ms each raise SQLSTATE 22023 and leave
--      the row unchanged; 0 is accepted (the Deribit reach anchor).
--   8  single-statement shape: the comment-stripped definition mentions compute_jobs
--      exactly once and that mention is the UPDATE.
--   9  unknown id returns false. Twinned by a layered mutation (the neuter field): the
--      only edit that makes an unknown id return true is a constant return, which
--      also trips arms 3, 4 and 5, so those three are neutered first.
--
-- Every identity carries a digit. Every `TEST FAILED (N)` raise sits DIRECTLY in the DO
-- body (the mutation runner reads an identity only from a single-frame
-- `inline_code_block` raise); the pg_temp helpers return values and never raise an
-- identity. There is deliberately NO completion sentinel notice at the end of this
-- file: a sentinel moves the SENTINEL_FLOOR census in the CI workflow, which this phase
-- must not edit. Per-arm NOTICE lines are fine.
--
-- Inside this file's single transaction `now()` is frozen, so `updated_at` cannot show
-- that a write happened. "Unchanged" is asserted with the row's `ctid` plus its
-- metadata before and after: any UPDATE writes a new tuple version and moves `ctid`.
--
-- Lanes. It runs on the pg-lane (the mutation runner's lane, with the setup list below)
-- and on the local-stack lane CI's `sql-tests` runs (the committed dump plus the D-F
-- replay of the migration). Seeds are one auth user, profile, strategy and job per row
-- (one in-flight job per strategy and kind); ids are gen_random_uuid() and emails end in
-- @invalid.local. The file creates no table. The whole file is BEGIN ... ROLLBACK.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure, no psql meta-commands.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_compute_job_seed_hold.sql
--
-- RED-UNDER ANNOTATIONS. Each arm that exercises the migration carries a prose
-- `RED-UNDER:` and a machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE the arm reds on its own, then restores GREEN.
-- Schema: scripts/mutation-runner/GRAMMAR.md. The migration's own verify block pins the
-- ACL during the apply, so arm 1's twin is a post-apply `sql` GRANT (an `edit` widening
-- the GRANT would abort the apply and the gate would never run); every other twin edits
-- the one migration. `claim_token` is added by 20260515114555, not by the migration under
-- test, so that migration is in the apply list.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20261128120000_compute_job_seed_hold.sql"]}

BEGIN;

-- Seeds one auth user, profile, strategy and compute_jobs row in the given status, with
-- the given claim token and metadata (SQL NULL stays NULL; 'null'::jsonb is a JSON
-- null). Returns the job id. pg_temp functions live and die with this transaction and
-- carry no arm.
CREATE FUNCTION pg_temp.sh_job(p_status text, p_token uuid, p_meta jsonb) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_strat uuid;
  v_job   uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sh-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sh') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sh-strat') RETURNING id INTO v_strat;
  INSERT INTO public.compute_jobs (id, kind, strategy_id, status, claim_token, metadata)
    VALUES (v_job, 'compute_analytics', v_strat, p_status, p_token, p_meta);
  RETURN v_job;
END
$f$;

-- The metadata of one job.
CREATE FUNCTION pg_temp.sh_meta(p_job uuid) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT metadata FROM public.compute_jobs WHERE id = p_job
$f$;

-- The physical tuple id of one job. Any UPDATE writes a new tuple version, so an
-- unchanged ctid plus unchanged metadata proves a statement wrote nothing.
CREATE FUNCTION pg_temp.sh_ctid(p_job uuid) RETURNS text
LANGUAGE sql AS $f$
  SELECT ctid::text FROM public.compute_jobs WHERE id = p_job
$f$;

DO $$
DECLARE
  v_oid    oid;
  v_cfg    text[];
  v_secdef boolean;
  v_tok    uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_id     uuid;
  v_ok     boolean;
  v_m      jsonb;
  v_seed   jsonb;
  v_case   jsonb;
  v_want   jsonb;
  v_i      integer;
  v_n      integer;
  v_status text;
  v_ctid0  text;
  v_meta0  jsonb;
  v_raised boolean;
  v_state  text;
  v_def    text;
  v_floor  bigint := 1778112000000;
BEGIN
  v_seed := jsonb_build_object('source', 'wizard', 'correlation_id', 'corr-sh',
                               'member_progress', jsonb_build_array(jsonb_build_object('seq', 1)),
                               'unified_backbone_at_claim', true);

  -- ===== ARM 1 - the function's ACL and hardening ============================
  -- Absence is an EXCEPTION, never a skip: merging supabase/migrations/** applies to
  -- PRODUCTION with no human stop.
  -- RED-UNDER: on the live database, after the migration (and its own catalogue verify)
  --            has applied, GRANT EXECUTE on set_compute_job_seed_hold(uuid, uuid,
  --            bigint) TO authenticated: a SECURITY DEFINER writer of
  --            compute_jobs.metadata becomes callable through PostgREST by any signed-in
  --            user (T-257-02). A post-apply `sql` step, because an edit widening the
  --            GRANT would trip the migration's own verify block during the apply and the
  --            gate would never run.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.set_compute_job_seed_hold(uuid, uuid, bigint) TO authenticated"}]}
  v_oid := to_regprocedure('public.set_compute_job_seed_hold(uuid,uuid,bigint)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): public.set_compute_job_seed_hold(uuid, uuid, bigint) does not exist - this gate has nothing to test and must not skip';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (1): set_compute_job_seed_hold is not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog') THEN
    RAISE EXCEPTION 'TEST FAILED (1): set_compute_job_seed_hold does not pin search_path to public, pg_catalog';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (1): service_role lacks EXECUTE on set_compute_job_seed_hold - the worker cannot call it';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (1): anon can EXECUTE set_compute_job_seed_hold';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (1): authenticated can EXECUTE set_compute_job_seed_hold';
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (1): PUBLIC still holds EXECUTE on set_compute_job_seed_hold';
  END IF;
  RAISE NOTICE 'arm 1 OK: SECURITY DEFINER, pinned search_path, service_role-only EXECUTE.';

  -- ===== ARM 2 - the merge keeps every other key =============================
  -- The row carries source, correlation_id, member_progress and
  -- unified_backbone_at_claim. The floor sits above the int4 range, so a narrower
  -- numeric type would show here.
  -- RED-UNDER: in the UPDATE, turn the CASE's object branch into a fresh empty object (the
  --            `THEN metadata` arm becomes `THEN '{}'::jsonb`). The seed-hold mark is
  --            still written and the function still returns true, but every other key is
  --            replaced rather than merged, which is the lost update from the other
  --            side. The ACL arm is untouched, so this arm is the first failure.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261128120000_compute_job_seed_hold.sql","find":"THEN metadata","replace":"THEN '{}'::jsonb","occurrences":1}]}
  v_id := pg_temp.sh_job('running', v_tok, v_seed);
  v_ok := public.set_compute_job_seed_hold(v_id, v_tok, v_floor);
  IF v_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (2): a matching-token write on a running row returned % (expected true)', v_ok;
  END IF;
  v_m := pg_temp.sh_meta(v_id);
  IF v_m -> 'seed_hold_ms' IS DISTINCT FROM to_jsonb(v_floor) THEN
    RAISE EXCEPTION 'TEST FAILED (2): seed_hold_ms is not the written value % (got %)', v_floor, v_m;
  END IF;
  IF v_m IS DISTINCT FROM (v_seed || jsonb_build_object('seed_hold_ms', v_floor)) THEN
    RAISE EXCEPTION 'TEST FAILED (2): the merge changed or dropped a key it does not own (got %)', v_m;
  END IF;
  RAISE NOTICE 'arm 2 OK: seed_hold_ms merged beside every prior key.';

  -- ===== ARM 3 - a stale token writes nothing ================================
  -- RED-UNDER: in the UPDATE, replace the `AND claim_token IS NOT DISTINCT FROM
  --            p_claim_token` term with `AND TRUE`. The claim fence is then gone while
  --            every other guard survives, so a worker holding a STALE token (its job
  --            was reclaimed and handed to a second worker) writes the live worker's
  --            row (T-257-03). Arm 2 (a matching token still writes) cannot see it,
  --            which is why arm 3 is the one identity that can name this regression.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261128120000_compute_job_seed_hold.sql","find":"     AND claim_token IS NOT DISTINCT FROM p_claim_token","replace":"     AND TRUE","occurrences":1}]}
  v_id := pg_temp.sh_job('running', v_tok, v_seed);
  v_ctid0 := pg_temp.sh_ctid(v_id);
  v_meta0 := pg_temp.sh_meta(v_id);
  v_ok := public.set_compute_job_seed_hold(v_id, v_other, v_floor);
  IF v_ok IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (3): a stale-token write returned % (expected false)', v_ok;
  END IF;
  IF pg_temp.sh_ctid(v_id) IS DISTINCT FROM v_ctid0 OR pg_temp.sh_meta(v_id) IS DISTINCT FROM v_meta0 THEN
    RAISE EXCEPTION 'TEST FAILED (3): a stale claim token wrote the row - fence broken (metadata now %)', pg_temp.sh_meta(v_id);
  END IF;
  RAISE NOTICE 'arm 3 OK: a stale token is a no-op.';

  -- ===== ARM 4 - a NULLed token never matches ================================
  -- RED-UNDER: delete the `AND claim_token IS NOT NULL` term from the UPDATE. With
  --            `IS NOT DISTINCT FROM`, a NULL parameter then matches a watchdog-
  --            reclaimed row whose token is NULL, so a NULL-passing caller writes a
  --            row it does not own. Arm 3's stale token is NON-NULL and still fails to
  --            match, so only a NULL on both sides can see it.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261128120000_compute_job_seed_hold.sql","find":"\n     AND claim_token IS NOT NULL","replace":"","occurrences":1}]}
  -- One loop, so each failure raise appears once (the neuter field of arm 9's twin
  -- silences the FIRST raise carrying an identity): case 1 is a reclaimed row (NULL
  -- token) written by a NULL caller, case 2 a claimed row written by a NULL caller.
  FOREACH v_i IN ARRAY ARRAY[1, 2] LOOP
    v_id := pg_temp.sh_job('running', CASE WHEN v_i = 1 THEN NULL ELSE v_tok END, v_seed);
    v_ctid0 := pg_temp.sh_ctid(v_id);
    v_meta0 := pg_temp.sh_meta(v_id);
    v_ok := public.set_compute_job_seed_hold(v_id, NULL, v_floor);
    IF v_ok IS DISTINCT FROM FALSE THEN
      RAISE EXCEPTION 'TEST FAILED (4): a NULL-token write returned % on case % (1 = reclaimed row, 2 = claimed row; expected false)', v_ok, v_i;
    END IF;
    IF pg_temp.sh_ctid(v_id) IS DISTINCT FROM v_ctid0 OR pg_temp.sh_meta(v_id) IS DISTINCT FROM v_meta0 THEN
      RAISE EXCEPTION 'TEST FAILED (4): a NULL token wrote case % (1 = reclaimed row, 2 = claimed row; metadata now %)', v_i, pg_temp.sh_meta(v_id);
    END IF;
  END LOOP;
  RAISE NOTICE 'arm 4 OK: a NULL token never matches.';

  -- ===== ARM 5 - only a running row is written ===============================
  -- RED-UNDER: replace the UPDATE's `AND status = 'running'` term with `AND TRUE`. A job
  --            that already finished, or one waiting for a retry, then accepts a hold
  --            written by an orphaned worker. Arms 2 to 4 use running rows only, so only
  --            a row in another status can see it.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20261128120000_compute_job_seed_hold.sql","find":"     AND status = 'running'","replace":"     AND TRUE","occurrences":1}]}
  FOREACH v_status IN ARRAY ARRAY['done', 'pending', 'failed_retry', 'failed_final'] LOOP
    v_id := pg_temp.sh_job(v_status, v_tok, v_seed);
    v_ctid0 := pg_temp.sh_ctid(v_id);
    v_meta0 := pg_temp.sh_meta(v_id);
    v_ok := public.set_compute_job_seed_hold(v_id, v_tok, v_floor);
    IF v_ok IS DISTINCT FROM FALSE THEN
      RAISE EXCEPTION 'TEST FAILED (5): a matching-token write on a % row returned % (expected false)', v_status, v_ok;
    END IF;
    IF pg_temp.sh_ctid(v_id) IS DISTINCT FROM v_ctid0 OR pg_temp.sh_meta(v_id) IS DISTINCT FROM v_meta0 THEN
      RAISE EXCEPTION 'TEST FAILED (5): a % row accepted a seed-hold write (metadata now %)', v_status, pg_temp.sh_meta(v_id);
    END IF;
  END LOOP;
  RAISE NOTICE 'arm 5 OK: done, pending, failed_retry and failed_final rows are never written.';

  -- ===== ARM 6 - metadata that is not an object ==============================
  -- RED-UNDER: replace the whole CASE that turns non-object metadata into a fresh object
  --            with the bare `metadata`. NULL || object is NULL and array || object is an
  --            array, so the mark is silently lost or malformed on exactly the rows the
  --            enqueue path can leave behind. The object case of arm 2 still passes, so
  --            this arm is the first failure.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"edit","file":"supabase/migrations/20261128120000_compute_job_seed_hold.sql","find":"CASE WHEN jsonb_typeof(metadata) = 'object'\n                         THEN metadata\n                         ELSE '{}'::jsonb\n                    END","replace":"metadata","occurrences":1}]}
  v_want := jsonb_build_object('seed_hold_ms', v_floor);
  v_i := 0;
  FOREACH v_case IN ARRAY ARRAY[NULL::jsonb, 'null'::jsonb, '[1,2]'::jsonb, '"text"'::jsonb, '7'::jsonb] LOOP
    v_i := v_i + 1;
    v_id := pg_temp.sh_job('running', v_tok, v_case);
    v_ok := public.set_compute_job_seed_hold(v_id, v_tok, v_floor);
    IF v_ok IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'TEST FAILED (6): the write returned % on non-object metadata case % (expected true)', v_ok, v_i;
    END IF;
    v_m := pg_temp.sh_meta(v_id);
    IF v_m IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION 'TEST FAILED (6): non-object metadata case % ended as %, expected exactly the seed-hold object', v_i, v_m;
    END IF;
  END LOOP;
  RAISE NOTICE 'arm 6 OK: NULL, JSON null, array and scalar metadata become exactly the seed-hold object.';

  -- ===== ARM 7 - the input guard =============================================
  -- RED-UNDER: replace the guard's condition (`IF p_floor_ms IS NULL OR p_floor_ms < 0
  --            THEN`) with `IF FALSE THEN`. A NULL then lands as a JSON null mark and a
  --            negative value lands as is, so run 2 would read a hold that is not an
  --            instant. Arms 2 to 6 pass valid floors only, so only this arm sees it.
  -- RED-UNDER-M: {"arm":"7","apply":[{"kind":"edit","file":"supabase/migrations/20261128120000_compute_job_seed_hold.sql","find":"IF p_floor_ms IS NULL OR p_floor_ms < 0 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  FOREACH v_i IN ARRAY ARRAY[1, 2] LOOP
    v_id := pg_temp.sh_job('running', v_tok, v_seed);
    v_ctid0 := pg_temp.sh_ctid(v_id);
    v_meta0 := pg_temp.sh_meta(v_id);
    v_raised := false;
    v_state := NULL;
    BEGIN
      IF v_i = 1 THEN
        v_ok := public.set_compute_job_seed_hold(v_id, v_tok, NULL);
      ELSE
        v_ok := public.set_compute_job_seed_hold(v_id, v_tok, -1);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_raised := true;
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    END;
    IF NOT v_raised OR v_state IS DISTINCT FROM '22023' THEN
      RAISE EXCEPTION 'TEST FAILED (7): input case % (1 = NULL, 2 = -1) did not raise SQLSTATE 22023 (raised %, state %)', v_i, v_raised, v_state;
    END IF;
    IF pg_temp.sh_ctid(v_id) IS DISTINCT FROM v_ctid0 OR pg_temp.sh_meta(v_id) IS DISTINCT FROM v_meta0 THEN
      RAISE EXCEPTION 'TEST FAILED (7): input case % wrote the row before raising (metadata now %)', v_i, pg_temp.sh_meta(v_id);
    END IF;
  END LOOP;
  v_id := pg_temp.sh_job('running', v_tok, v_seed);
  v_ok := public.set_compute_job_seed_hold(v_id, v_tok, 0);
  IF v_ok IS DISTINCT FROM TRUE OR pg_temp.sh_meta(v_id) -> 'seed_hold_ms' IS DISTINCT FROM '0'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (7): a floor of 0 (the Deribit reach anchor) was not accepted (returned %, metadata %)', v_ok, pg_temp.sh_meta(v_id);
  END IF;
  RAISE NOTICE 'arm 7 OK: NULL and negative floors raise 22023 and write nothing; 0 is accepted.';

  -- ===== ARM 8 - one statement, no read of the row first =====================
  -- A body that reads the row and then writes it back is the racy shape REFUSALRACE
  -- removed; arm 2 cannot see it (one session). The definition is comment-stripped first
  -- so prose cannot satisfy or defeat the count.
  -- RED-UNDER: insert `PERFORM 1 FROM public.compute_jobs WHERE id = p_job_id;` before the
  --            UPDATE. The function still passes arms 2 to 7 (one session, same result),
  --            but it now reads the row it then writes, so the definition mentions
  --            compute_jobs twice and this arm is the first failure.
  -- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261128120000_compute_job_seed_hold.sql","find":"UPDATE public.compute_jobs","replace":"PERFORM 1 FROM public.compute_jobs WHERE id = p_job_id;\n  UPDATE public.compute_jobs","occurrences":1}]}
  v_def := regexp_replace(pg_get_functiondef(v_oid), '--[^\n]*', '', 'g');
  v_n := (length(v_def) - length(replace(v_def, 'compute_jobs', ''))) / length('compute_jobs');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (8): the comment-stripped definition mentions compute_jobs % times (expected exactly 1, the UPDATE)', v_n;
  END IF;
  IF v_def !~ 'UPDATE\s+public\.compute_jobs' THEN
    RAISE EXCEPTION 'TEST FAILED (8): the one compute_jobs mention is not the UPDATE';
  END IF;
  RAISE NOTICE 'arm 8 OK: the definition is one UPDATE and reads nothing first.';

  -- ===== ARM 9 - an unknown id ===============================================
  -- RED-UNDER: replace the final `RETURN FOUND;` with `RETURN TRUE;`. Nothing else makes an
  --            unknown id report a write, and that edit also trips arms 3, 4 and 5
  --            (every no-op case would report true), so the layered twin neuters those
  --            three first and arm 9 is then the first failure.
  -- RED-UNDER-M: {"arm":"9","apply":[{"kind":"edit","file":"supabase/migrations/20261128120000_compute_job_seed_hold.sql","find":"RETURN FOUND;","replace":"RETURN TRUE;","occurrences":1}],"neuter":[{"arm":"3"},{"arm":"4"},{"arm":"5"}]}
  v_id := gen_random_uuid();
  v_ok := public.set_compute_job_seed_hold(v_id, v_tok, v_floor);
  IF v_ok IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (9): an unknown id returned % (expected false)', v_ok;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_jobs WHERE id = v_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (9): the write created a row for an unknown id';
  END IF;
  RAISE NOTICE 'arm 9 OK: an unknown id returns false.';
END
$$;

ROLLBACK;
