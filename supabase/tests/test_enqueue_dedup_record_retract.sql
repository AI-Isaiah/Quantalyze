-- Test: an enqueue that dedups onto an in-flight job records the caller's metadata and
-- retracts an inherited ledger-refresh marker.
-- Phase 211 SYNCJOBS, plan 03 (ROADMAP SC-2 and SC-4; decisions D11-1 to D11-13).
-- Guards migration 20261114130000_enqueue_dedup_record_retract.sql.
--
-- Background
-- ----------
-- `_enqueue_compute_job_internal` dedups on (target, kind) over the in-flight statuses and
-- returns the existing job's id, and used to discard the caller's `p_metadata` on that path.
-- A user's resync whose enqueue landed on a recurring ledger refresh's job was then served
-- BY that job and inherited its `source` marker, which the status bridge reads as "a
-- refresh, keep the figures", until a backstop ran afterwards. Phase 191 named that window
-- D-02. The founder chose option B on 2026-11-14: on every dedup hit the caller's metadata
-- is recorded in public.compute_job_dedup_events and an inherited marker is retracted in
-- the same call, through public.retract_ledger_refresh_marker, for a caller that sends a
-- correlation_id and no marker on a marker-capable kind.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each twin's
-- FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend on arms listed
-- before it). Sixteen arms: plan 03 of this phase created the file with SITE-A, plan 05
-- appended the rest, and review WR-01 added DPC-SKIP.
--   SITE-A  the resync-tail collision (Phase 191 D-02): the optimistic look-up finds an
--           in-flight derive_broker_dailies job that carries a ledger-refresh marker, and
--           a caller sending exactly what the process_key_long tail sends (a
--           correlation_id and NO `source` key at all) is served by it. The call returns
--           that job's id, no second job exists, the marker is gone and replaced by
--           refresh_marker_retracted, the caller's correlation_id is on the row, every
--           other key is untouched, and exactly one compute_job_dedup_events row names the
--           job with the sent object and the marker the same call retracted.
--   SITE-B  the lost-race return: the look-up MISSES, the INSERT loses to a competing
--           in-flight row that appears between them, and the re-read finds that competitor.
--           The function serves the call from the re-read, so it must record and retract
--           exactly as the look-up site does. Forced on the live 10-arg overload by a
--           BEFORE INSERT trigger that inserts a still-in-flight, marked competitor.
--   NO-MERGE  a dedup hit merges NO caller key into the job row and does not move its
--           updated_at (the _resume_duplicate_job shape: different verification id and flow
--           type); the caller's whole object is recorded instead.
--   KIND-COMPOSITE  a stitch_composite job's ledger-refresh-composite marker is retracted
--           for the real keys/sync shape.
--   KIND-CSV  a compute_analytics_from_csv job's marker is retracted.
--   MARKED-CALLER  a caller that itself sends a refresh marker retracts nothing; the marker
--           stays and the event is recorded with no retracted_marker.
--   NO-CORRELATION  the finalize-wizard shape (a source, no correlation_id) retracts nothing
--           in SQL: the recorded residual whose TypeScript backstop stays.
--   NON-MARKER-KIND  process_key_long is outside the kind list: an artificial marker stays.
--   PARENTED  a parented enqueue records and retracts nothing.
--   DPC-SKIP  an UNPARENTED caller with correlation metadata that dedups onto a
--           `done_pending_children` row (a fan-in child) records nothing and retracts nothing:
--           the helper's INSERT would take a FOR KEY SHARE through the FK on a row the
--           ancestor-first protocol locks FOR UPDATE (review WR-01).
--   EMPTY-META  NULL, empty and non-object metadata record nothing and never raise.
--   OVERSIZE  metadata over 8192 bytes is recorded as {oversize_bytes: n}; the enqueue
--           still succeeds.
--   FRESH-INSERT  only a dedup records: a call that inserts its own new job writes no event.
--   ACL-HELPER  the helper is SECURITY DEFINER with a pinned search_path and EXECUTE for
--           service_role only (not anon, authenticated or PUBLIC).
--   TABLE   compute_job_dedup_events has RLS enabled and NOT forced, exactly one deny-all
--           policy, no PUBLIC/anon/authenticated privilege, and service_role SELECT only.
--   BODY-PIN  the 7-argument overload (unreachable: every 7-argument call is ambiguous,
--           42725) and the 10-argument overload each carry the helper call exactly twice, and
--           the helper reuses public.retract_ledger_refresh_marker once with no UPDATE of its
--           own. LAST, because the SITE-A, SITE-B and FRESH-INSERT twins change the count it
--           reads and each of those arms must fail first.
--
-- NOT DUPLICATED HERE: D11-2's rule that a done row is never rewritten is enforced inside the
-- reused public.retract_ledger_refresh_marker (its `status <> 'done'` predicate) and is pinned
-- by arm 7 of test_compute_job_metadata_merge.sql, so this gate does not re-test it.
--
-- Every `TEST FAILED (N)` raise sits DIRECTLY in the DO body (the mutation runner reads an
-- identity only from a single-frame `inline_code_block` raise); the pg_temp helpers return
-- values and never raise an identity. `RESET ROLE` runs before every raise that follows a
-- `SET LOCAL ROLE service_role`, so a failing arm reports under the owner role.
--
-- Lanes. This file runs on BOTH lanes: the pg-lane under `sql-mutation` (with the setup
-- list below) and the local Supabase stack under `sql-tests` (the committed dump plus the
-- D-F replay of the migration). It uses no dblink and no psql meta-command, so there is no
-- LANE-ONLY line. Seeds are one auth user, profile, strategy and job per scenario (one
-- in-flight job per strategy and kind), ids are gen_random_uuid(), emails end in
-- @invalid.local, and every assertion is scoped to this file's own fixture ids (shared-DB
-- hygiene: TEST is shared with other people's CI). The file creates no table; SITE-B
-- creates a throwaway schema (dd_gate: a sequence, a trigger function and a trigger bound by
-- its WHEN clause to that arm's own strategy and kind) that dies with the ROLLBACK. The whole
-- file is BEGIN ... ROLLBACK.
--
-- The retraction arms use MARKER-CAPABLE kinds; NON-MARKER-KIND, NO-MERGE and OVERSIZE use
-- process_key_long on purpose. The retired `compute_analytics` kind is rejected by
-- the enqueue function's admission guard, so it can never be a dedup target.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on failure.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_enqueue_dedup_record_retract.sql
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm that exercises the migration carries a prose
-- `RED-UNDER:` and a machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE the arm reds on its own, then restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. The setup list below is the one the fan-in gates use
-- (it carries the enqueue chain up to 20261024120000), then the migration that creates
-- retract_ledger_refresh_marker, then the migration under test.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","scripts/pg-lane/fixtures/36-fixture-dblink.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql"]}

BEGIN;

-- Seeds one auth user, profile and strategy, then one in-flight compute_jobs row of the
-- given kind and status with the given metadata (SQL NULL stays NULL). Returns the
-- strategy id. pg_temp functions live and die with this transaction and carry no arm.
CREATE FUNCTION pg_temp.dd_seed(p_kind text, p_status text, p_meta jsonb) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_strat uuid;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'dd-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'dd') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'dd-strat') RETURNING id INTO v_strat;
  INSERT INTO public.compute_jobs (kind, strategy_id, status, metadata)
    VALUES (p_kind, v_strat, p_status, p_meta);
  RETURN v_strat;
END
$f$;

-- Seeds one auth user, profile and strategy and NO job. Returns the strategy id.
CREATE FUNCTION pg_temp.dd_strat() RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_strat uuid;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'dd-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'dd') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'dd-strat') RETURNING id INTO v_strat;
  RETURN v_strat;
END
$f$;

-- Calls enqueue_compute_job as the real callers do (through service_role) inside an inner
-- block that ONLY captures SQLSTATE and SQLERRM, so an arm asserts after the call and a
-- refusal is reported under the arm's own name. Returns the job id, the SQLSTATE (NULL on
-- success) and the message. It raises no arm identity.
CREATE FUNCTION pg_temp.dd_call(p_strat uuid, p_kind text, p_meta jsonb,
                                p_parents uuid[] DEFAULT '{}'::uuid[],
                                OUT o_ret uuid, OUT o_state text, OUT o_msg text)
LANGUAGE plpgsql AS $f$
BEGIN
  SET LOCAL ROLE service_role;
  BEGIN
    o_ret := public.enqueue_compute_job(
      p_strategy_id    => p_strat,
      p_kind           => p_kind,
      p_parent_job_ids => p_parents,
      p_metadata       => p_meta
    );
  EXCEPTION WHEN OTHERS THEN
    o_state := SQLSTATE; o_msg := SQLERRM;
  END;
  RESET ROLE;
END
$f$;

-- The id of the one compute_jobs row of this strategy and kind, any status.
CREATE FUNCTION pg_temp.dd_job(p_strat uuid, p_kind text) RETURNS uuid
LANGUAGE sql AS $f$
  SELECT id FROM public.compute_jobs WHERE strategy_id = p_strat AND kind = p_kind
$f$;

DO $$
DECLARE
  v_strat   uuid;
  v_seed    uuid;
  v_ret     uuid;
  v_n       integer;
  v_m       jsonb;
  v_sent    jsonb := jsonb_build_object('correlation_id', 'c-site-a');
  v_enq_at  text  := '2026-11-14T00:00:00Z';
  v_ev      record;
  v_state   text;
  v_oid     oid;
  v_cfg     text[];
  v_secdef  boolean;
  v_rel     regclass;
  v_pol     record;
  v_privs   text;
  v_src     text;
  v_msg     text;
  v_shots   bigint;
  v_comp    uuid;
  v_seed_meta jsonb;
  v_ts      timestamptz;
  v_got_ts  timestamptz;
  v_cm      jsonb;
  v_marker  text;
  v_par     uuid;
  v_ret2    uuid;
  v_ret3    uuid;
  v_state2  text;
  v_state3  text;
  v_msg2    text;
  v_msg3    text;
BEGIN
  -- ===== ARM SITE-A - the optimistic look-up hit retracts and records ==========
  -- The seeded job is the recurring refresh's: `source` is ledger-refresh and `enqueued_at`
  -- is a literal the arm checks for survival. The caller is the process_key_long tail:
  -- a correlation_id, no `source` key.
  -- RED-UNDER: delete the SITE A helper call from the 10-argument overload in the migration
  --            (the line that runs before `RETURN v_existing_id;`). The enqueue still
  --            dedups and still returns the refresh job's id, so a one-job-one-id check
  --            stays green, but the marker is never retracted and nothing is recorded:
  --            the resync tail is served by the refresh job with its protection intact,
  --            which is exactly the D-02 window this migration closes. This arm is the
  --            first and only arm, so it is the first failure.
  -- RED-UNDER-M: {"arm":"SITE-A","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"    PERFORM public._record_enqueue_dedup(v_existing_id, p_kind, p_metadata, p_parent_job_ids);  -- Phase 211 D11, SITE A (10-arg)","replace":"","occurrences":1}]}
  v_strat := pg_temp.dd_seed('derive_broker_dailies', 'pending',
               jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', v_enq_at));
  v_seed := pg_temp.dd_job(v_strat, 'derive_broker_dailies');

  -- Called as the real callers call it: through the service-role client. The wrapper is
  -- SECURITY DEFINER and its owner gate short-circuits when auth.uid() is NULL, so the
  -- role neither masks nor manufactures the outcome.
  SET LOCAL ROLE service_role;
  v_ret := public.enqueue_compute_job(
    p_strategy_id => v_strat,
    p_kind        => 'derive_broker_dailies',
    p_metadata    => v_sent
  );
  RESET ROLE;

  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): the enqueue returned % but the in-flight refresh job is % (the dedup must hand back the existing id)', v_ret, v_seed;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.compute_jobs
   WHERE strategy_id = v_strat AND kind = 'derive_broker_dailies'
     AND status IN ('pending', 'running', 'done_pending_children');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): % in-flight derive_broker_dailies rows exist for the strategy after the dedup (expected exactly 1)', v_n;
  END IF;

  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_seed);
  IF v_m ? 'source' THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): the refresh marker is still on the job after a correlation-id caller deduped onto it, so the resync stays protected as a refresh (metadata %)', v_m;
  END IF;
  IF v_m ->> 'refresh_marker_retracted' IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): refresh_marker_retracted is not the retracted marker (metadata %)', v_m;
  END IF;
  IF v_m ->> 'correlation_id' IS DISTINCT FROM 'c-site-a' THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): the caller''s correlation_id is not on the job (metadata %)', v_m;
  END IF;
  IF v_m ->> 'enqueued_at' IS DISTINCT FROM v_enq_at THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): the retraction changed a key it does not own, enqueued_at (metadata %)', v_m;
  END IF;

  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): % compute_job_dedup_events rows name the job (expected exactly 1)', v_n;
  END IF;
  SELECT caller_metadata, retracted_marker, deduped_at INTO v_ev
    FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_ev.caller_metadata IS DISTINCT FROM v_sent THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): the recorded caller_metadata is % but the caller sent %', v_ev.caller_metadata, v_sent;
  END IF;
  IF v_ev.retracted_marker IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): the event row says the retracted marker was % (expected ledger-refresh)', v_ev.retracted_marker;
  END IF;
  IF v_ev.deduped_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-A): the event row has no deduped_at';
  END IF;

  -- ===== ARM SITE-B - the lost-race return retracts and records ===============
  -- The strategy starts with NO job, so the optimistic look-up misses. A BEFORE INSERT row
  -- trigger, bound by WHEN to this arm's own strategy and kind, inserts a competing
  -- in-flight row ON THE FIRST SHOT ONLY. The function's own INSERT then loses to the
  -- partial unique index (ON CONFLICT DO NOTHING returns no id) and its re-read finds the
  -- competitor, which is the SITE B return. The competitor is never flipped to done (that
  -- is the 40001 file's after-insert trigger, deliberately not copied): flipped, the re-read
  -- would find nothing and the function would raise instead of returning.
  -- The depth guard precedes nextval so the competitor's own nested insert fires no shot.
  -- The shot counter is a SEQUENCE because a sequence is not rolled back with the inner
  -- exception block, so the count survives for the assertions after it.
  -- RED-UNDER: delete the SITE B helper call from the 10-argument overload in the migration
  --            (the line that runs before the final `RETURN v_new_id;`). The call still
  --            returns the competitor's id, so a one-job-one-id check stays green, but the
  --            marker the competitor carries is never retracted and nothing is recorded:
  --            a resync that loses the insert race is served by the refresh job with its
  --            protection intact, the D-02 window again, through the return site the
  --            look-up arm cannot reach. SITE-A is unaffected (its call is a different
  --            line), so this arm is the first failure.
  -- RED-UNDER-M: {"arm":"SITE-B","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"  PERFORM public._record_enqueue_dedup(v_new_id, p_kind, p_metadata, p_parent_job_ids);  -- Phase 211 D11, SITE B (10-arg)\n","replace":"","occurrences":1}]}
  v_strat := pg_temp.dd_strat();
  v_sent  := jsonb_build_object('correlation_id', 'c-site-b');

  CREATE SCHEMA dd_gate;
  CREATE SEQUENCE dd_gate.shots;
  CREATE FUNCTION dd_gate.before_ins() RETURNS trigger
    LANGUAGE plpgsql AS $f$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
    IF nextval('dd_gate.shots') > 1 THEN RETURN NEW; END IF;
    INSERT INTO public.compute_jobs (strategy_id, kind, status, metadata)
    VALUES (NEW.strategy_id, NEW.kind, 'pending',
            jsonb_build_object('source', 'ledger-refresh', 'dd_gate', 'competitor'));
    RETURN NEW;
  END $f$;
  EXECUTE format(
    'CREATE TRIGGER dd_gate_bi BEFORE INSERT ON public.compute_jobs '
    'FOR EACH ROW WHEN (NEW.strategy_id = %L::uuid AND NEW.kind = %L) '
    'EXECUTE FUNCTION dd_gate.before_ins()',
    v_strat, 'derive_broker_dailies');

  v_ret := NULL; v_state := NULL; v_msg := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_ret := public.enqueue_compute_job(
      p_strategy_id => v_strat,
      p_kind        => 'derive_broker_dailies',
      p_metadata    => v_sent
    );
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  RESET ROLE;

  SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO v_shots FROM dd_gate.shots;
  v_comp := (SELECT id FROM public.compute_jobs
              WHERE strategy_id = v_strat AND kind = 'derive_broker_dailies'
                AND metadata ->> 'dd_gate' = 'competitor');

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): the enqueue raised SQLSTATE % (message: %) instead of returning the competing job', v_state, v_msg;
  END IF;
  IF v_shots <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): the race trigger fired % shot(s), expected exactly 1: the arm must lose the insert race exactly once, or the call did not take the lost-race return this arm pins', v_shots;
  END IF;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): no competitor row exists for the strategy, so the race never happened';
  END IF;
  IF v_ret IS DISTINCT FROM v_comp THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): the enqueue returned % but the competing in-flight job is % (the lost-race return must hand back the winner''s id)', v_ret, v_comp;
  END IF;

  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_comp);
  IF v_m ? 'source' THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): the refresh marker is still on the competing job after a correlation-id caller lost the insert race onto it (metadata %)', v_m;
  END IF;
  IF v_m ->> 'refresh_marker_retracted' IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): refresh_marker_retracted is not the retracted marker (metadata %)', v_m;
  END IF;
  IF v_m ->> 'correlation_id' IS DISTINCT FROM 'c-site-b' THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): the caller''s correlation_id is not on the competing job (metadata %)', v_m;
  END IF;

  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_comp;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): % compute_job_dedup_events rows name the competing job (expected exactly 1)', v_n;
  END IF;
  SELECT caller_metadata, retracted_marker INTO v_ev
    FROM public.compute_job_dedup_events WHERE job_id = v_comp;
  IF v_ev.caller_metadata IS DISTINCT FROM v_sent THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): the recorded caller_metadata is % but the caller sent %', v_ev.caller_metadata, v_sent;
  END IF;
  IF v_ev.retracted_marker IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (SITE-B): the event row says the retracted marker was % (expected ledger-refresh)', v_ev.retracted_marker;
  END IF;

  -- ===== ARM NO-MERGE - a dedup hit merges no caller key into the job row =======
  -- D11-1 / D11-3: the caller's metadata is RECORDED, never merged. The job is an in-flight
  -- process_key_long (not marker-capable, no marker) carrying a verification id and flow type;
  -- the caller is the `_resume_duplicate_job` shape, sending a DIFFERENT verification id and
  -- flow type beside its correlation_id. The row must come back byte-identical and its
  -- updated_at must not move. Inside one transaction now() is constant, so updated_at is
  -- seeded a day in the past: a rewrite would stamp it with now() and be seen.
  -- ORDER: this arm precedes every arm whose caller sends keys beyond correlation_id. SITE-A
  -- and SITE-B send ONLY a correlation_id, and the retraction already writes that key, so a
  -- merge of {correlation_id} changes nothing they check and their twins stay on their own arms.
  -- RED-UNDER: in the helper, after the oversize computation and before the INSERT, add
  --            `UPDATE public.compute_jobs SET metadata = metadata || p_metadata WHERE id =
  --            p_job_id;`. The enqueue still dedups, still returns the seeded id and still
  --            records the event, so the return and event checks stay green, but the caller's
  --            verification id and flow type overwrite the in-flight job's own: the two-key
  --            clobber the dedup exists to avoid, and the row's updated_at moves.
  -- RED-UNDER-M: {"arm":"NO-MERGE","apply":[{"kind":"insert-after","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","anchor":"  v_bytes := octet_length(p_metadata::text);","text":"\n  UPDATE public.compute_jobs SET metadata = metadata || p_metadata WHERE id = p_job_id;","occurrences":1}]}
  v_strat     := pg_temp.dd_strat();
  v_seed_meta := jsonb_build_object('verification_id', 'v-first', 'flow_type', 'resync');
  v_ts        := now() - interval '1 day';
  v_sent      := jsonb_build_object('correlation_id', 'c-nomerge', 'verification_id', 'v-second', 'flow_type', 'onboard');
  INSERT INTO public.compute_jobs (kind, strategy_id, status, metadata, updated_at)
    VALUES ('process_key_long', v_strat, 'pending', v_seed_meta, v_ts)
    RETURNING id INTO v_seed;

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'process_key_long', v_sent);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (NO-MERGE): the enqueue raised SQLSTATE % (message: %)', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (NO-MERGE): the enqueue returned % but the in-flight job is % (the dedup must hand back the existing id)', v_ret, v_seed;
  END IF;
  SELECT metadata, updated_at INTO v_m, v_got_ts FROM public.compute_jobs WHERE id = v_seed;
  IF v_m IS DISTINCT FROM v_seed_meta THEN
    RAISE EXCEPTION 'TEST FAILED (NO-MERGE): the in-flight job''s metadata is % after a dedup hit, expected exactly the seeded % (a caller key was merged into the job row)', v_m, v_seed_meta;
  END IF;
  IF v_got_ts IS DISTINCT FROM v_ts THEN
    RAISE EXCEPTION 'TEST FAILED (NO-MERGE): the job''s updated_at moved from % to % on a record-only dedup hit', v_ts, v_got_ts;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (NO-MERGE): % compute_job_dedup_events rows name the job (expected exactly 1)', v_n;
  END IF;
  SELECT caller_metadata INTO v_cm FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_cm IS DISTINCT FROM v_sent THEN
    RAISE EXCEPTION 'TEST FAILED (NO-MERGE): the recorded caller_metadata is % but the caller sent %', v_cm, v_sent;
  END IF;

  -- ===== ARM KIND-COMPOSITE - a composite refresh job's marker is retracted ======
  -- D11-2 / D11-8: stitch_composite is one of the three marker-capable kinds, and its marker
  -- is `ledger-refresh-composite`. The caller is the real keys/sync shape: a `source` that is
  -- NOT a refresh marker, plus a correlation_id.
  -- RED-UNDER: drop 'stitch_composite' from the helper's kind list. The enqueue still
  --            dedups and returns the composite job's id, and the event is still recorded,
  --            but the composite marker is never retracted: a key sync is served by a
  --            recurring composite refresh with its keep-the-figures protection intact.
  -- RED-UNDER-M: {"arm":"KIND-COMPOSITE","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"'compute_analytics_from_csv', 'stitch_composite')","replace":"'compute_analytics_from_csv')","occurrences":1}]}
  v_sent := jsonb_build_object('source', 'keys/sync', 'correlation_id', 'c-composite');
  v_strat := pg_temp.dd_seed('stitch_composite', 'pending',
               jsonb_build_object('source', 'ledger-refresh-composite', 'enqueued_at', v_enq_at));
  v_seed := pg_temp.dd_job(v_strat, 'stitch_composite');

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'stitch_composite', v_sent);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-COMPOSITE): the enqueue raised SQLSTATE % (message: %)', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-COMPOSITE): the enqueue returned % but the in-flight composite job is %', v_ret, v_seed;
  END IF;
  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_seed);
  IF v_m ? 'source' THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-COMPOSITE): the composite refresh marker is still on the job after a correlation-id caller deduped onto it (metadata %)', v_m;
  END IF;
  IF v_m ->> 'refresh_marker_retracted' IS DISTINCT FROM 'ledger-refresh-composite' THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-COMPOSITE): refresh_marker_retracted is not ledger-refresh-composite (metadata %)', v_m;
  END IF;
  SELECT retracted_marker INTO v_marker FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_marker IS DISTINCT FROM 'ledger-refresh-composite' THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-COMPOSITE): the event row says the retracted marker was % (expected ledger-refresh-composite)', v_marker;
  END IF;

  -- ===== ARM KIND-CSV - a CSV analytics job's marker is retracted ===============
  -- D11-8: compute_analytics_from_csv is the chain-edge forward's kind and is marker-capable.
  -- RED-UNDER: drop 'compute_analytics_from_csv' from the helper's kind list. The enqueue
  --            still dedups and records, but the inherited marker is never retracted.
  -- RED-UNDER-M: {"arm":"KIND-CSV","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"'derive_broker_dailies', 'compute_analytics_from_csv', 'stitch_composite')","replace":"'derive_broker_dailies', 'stitch_composite')","occurrences":1}]}
  v_sent := jsonb_build_object('correlation_id', 'c-csv');
  v_strat := pg_temp.dd_seed('compute_analytics_from_csv', 'pending',
               jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', v_enq_at));
  v_seed := pg_temp.dd_job(v_strat, 'compute_analytics_from_csv');

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'compute_analytics_from_csv', v_sent);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-CSV): the enqueue raised SQLSTATE % (message: %)', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-CSV): the enqueue returned % but the in-flight CSV job is %', v_ret, v_seed;
  END IF;
  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_seed);
  IF v_m ? 'source' THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-CSV): the refresh marker is still on the CSV job after a correlation-id caller deduped onto it (metadata %)', v_m;
  END IF;
  IF v_m ->> 'refresh_marker_retracted' IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-CSV): refresh_marker_retracted is not ledger-refresh (metadata %)', v_m;
  END IF;
  SELECT retracted_marker INTO v_marker FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_marker IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (KIND-CSV): the event row says the retracted marker was % (expected ledger-refresh)', v_marker;
  END IF;

  -- ===== ARM MARKED-CALLER - a caller that carries a marker retracts nothing =====
  -- D11-2: a recurring refresh that dedups onto another refresh job is the same kind of work,
  -- so the existing job keeps its marker. The caller sends source=ledger-refresh itself.
  -- RED-UNDER: delete the caller-has-no-marker conjunct (the `AND NOT COALESCE(...)` clause)
  --            from the helper. A refresh caller that dedups onto a refresh job then strips
  --            the marker the job is supposed to keep, and the status bridge stops treating
  --            the refresh as a refresh.
  -- RED-UNDER-M: {"arm":"MARKED-CALLER","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"     AND NOT COALESCE((p_metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite'), FALSE) THEN","replace":"     AND TRUE THEN","occurrences":1}]}
  v_sent := jsonb_build_object('source', 'ledger-refresh', 'correlation_id', 'c-marked');
  v_seed_meta := jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', v_enq_at);
  v_strat := pg_temp.dd_seed('derive_broker_dailies', 'pending', v_seed_meta);
  v_seed := pg_temp.dd_job(v_strat, 'derive_broker_dailies');

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'derive_broker_dailies', v_sent);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (MARKED-CALLER): the enqueue raised SQLSTATE % (message: %)', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (MARKED-CALLER): the enqueue returned % but the in-flight job is %', v_ret, v_seed;
  END IF;
  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_seed);
  IF v_m IS DISTINCT FROM v_seed_meta THEN
    RAISE EXCEPTION 'TEST FAILED (MARKED-CALLER): the job''s metadata is % after a marked caller deduped onto it, expected the seeded % (the marker must stay)', v_m, v_seed_meta;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (MARKED-CALLER): % compute_job_dedup_events rows name the job (expected exactly 1: a dedup is still recorded)', v_n;
  END IF;
  SELECT retracted_marker INTO v_marker FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_marker IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (MARKED-CALLER): the event row says a marker % was retracted, but nothing was', v_marker;
  END IF;

  -- ===== ARM NO-CORRELATION - the finalize-wizard shape retracts nothing in SQL ====
  -- D11-2 / D11-9, the recorded residual: finalize-wizard sends a `source` and NO
  -- correlation_id, so SQL does not retract for it and its TypeScript backstop stays.
  -- RED-UNDER: delete the `correlation_id IS NOT NULL` conjunct from the helper. The
  --            retraction then runs for a caller with no correlation id and strips the
  --            composite marker the wizard's own backstop is meant to handle.
  -- RED-UNDER-M: {"arm":"NO-CORRELATION","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"     AND (p_metadata ->> 'correlation_id') IS NOT NULL\n","replace":"","occurrences":1}]}
  v_sent := jsonb_build_object('source', 'finalize-wizard');
  v_seed_meta := jsonb_build_object('source', 'ledger-refresh-composite', 'enqueued_at', v_enq_at);
  v_strat := pg_temp.dd_seed('stitch_composite', 'pending', v_seed_meta);
  v_seed := pg_temp.dd_job(v_strat, 'stitch_composite');

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'stitch_composite', v_sent);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (NO-CORRELATION): the enqueue raised SQLSTATE % (message: %)', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (NO-CORRELATION): the enqueue returned % but the in-flight job is %', v_ret, v_seed;
  END IF;
  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_seed);
  IF v_m IS DISTINCT FROM v_seed_meta THEN
    RAISE EXCEPTION 'TEST FAILED (NO-CORRELATION): the job''s metadata is % after a caller with no correlation_id deduped onto it, expected the seeded % (the marker must stay)', v_m, v_seed_meta;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (NO-CORRELATION): % compute_job_dedup_events rows name the job (expected exactly 1)', v_n;
  END IF;
  SELECT retracted_marker INTO v_marker FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_marker IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (NO-CORRELATION): the event row says a marker % was retracted, but nothing was', v_marker;
  END IF;

  -- ===== ARM NON-MARKER-KIND - a kind outside the list retracts nothing ==========
  -- D11-8: process_key_long is not marker-capable. The artificial marker on the seed proves
  -- the kind list, not the marker, is what protects it.
  -- RED-UNDER: add 'process_key_long' to the helper's kind list. A correlation-id caller
  --            then strips a `source` key from a job whose kind never carries a refresh
  --            marker.
  -- RED-UNDER-M: {"arm":"NON-MARKER-KIND","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"'compute_analytics_from_csv', 'stitch_composite')","replace":"'compute_analytics_from_csv', 'stitch_composite', 'process_key_long')","occurrences":1}]}
  v_sent := jsonb_build_object('correlation_id', 'c-pkl');
  v_seed_meta := jsonb_build_object('source', 'ledger-refresh');
  v_strat := pg_temp.dd_seed('process_key_long', 'pending', v_seed_meta);
  v_seed := pg_temp.dd_job(v_strat, 'process_key_long');

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'process_key_long', v_sent);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (NON-MARKER-KIND): the enqueue raised SQLSTATE % (message: %)', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (NON-MARKER-KIND): the enqueue returned % but the in-flight job is %', v_ret, v_seed;
  END IF;
  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_seed);
  IF v_m IS DISTINCT FROM v_seed_meta THEN
    RAISE EXCEPTION 'TEST FAILED (NON-MARKER-KIND): the job''s metadata is % after a dedup on a kind outside the marker list, expected the seeded %', v_m, v_seed_meta;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (NON-MARKER-KIND): % compute_job_dedup_events rows name the job (expected exactly 1)', v_n;
  END IF;
  SELECT retracted_marker INTO v_marker FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_marker IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (NON-MARKER-KIND): the event row says a marker % was retracted, but nothing was', v_marker;
  END IF;

  -- ===== ARM PARENTED - a parented enqueue records and retracts nothing ==========
  -- D11-10: a fan-in child's enqueue is not a user resync. The in-flight child carries a
  -- marker and the caller sends a correlation_id, which WOULD retract, so only the parent
  -- skip stands between them.
  -- RED-UNDER: delete the parent-skip clause (`OR COALESCE(cardinality(p_parent_job_ids), 0)
  --            > 0`) from the helper's early return. A parented enqueue then retracts the
  --            marker and records an event it should not.
  -- RED-UNDER-M: {"arm":"PARENTED","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"     OR COALESCE(cardinality(p_parent_job_ids), 0) > 0\n","replace":"","occurrences":1}]}
  v_sent := jsonb_build_object('correlation_id', 'c-parented');
  v_seed_meta := jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', v_enq_at);
  v_strat := pg_temp.dd_seed('derive_broker_dailies', 'pending', v_seed_meta);
  v_seed := pg_temp.dd_job(v_strat, 'derive_broker_dailies');
  INSERT INTO public.compute_jobs (kind, strategy_id, status, metadata)
    VALUES ('process_key_long', v_strat, 'pending', NULL)
    RETURNING id INTO v_par;

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'derive_broker_dailies', v_sent, ARRAY[v_par]);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (PARENTED): the enqueue raised SQLSTATE % (message: %)', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (PARENTED): the enqueue returned % but the in-flight child is %', v_ret, v_seed;
  END IF;
  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_seed);
  IF v_m IS DISTINCT FROM v_seed_meta THEN
    RAISE EXCEPTION 'TEST FAILED (PARENTED): the child''s metadata is % after a parented enqueue deduped onto it, expected the seeded % (the marker must stay)', v_m, v_seed_meta;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (PARENTED): % compute_job_dedup_events rows name the child after a parented enqueue (expected 0)', v_n;
  END IF;

  -- ===== ARM DPC-SKIP - a dedup onto a done_pending_children row records nothing =====
  -- Review WR-01. The existing job is a fan-in child (`done_pending_children`), the row
  -- mark_compute_job_done and mark_compute_job_failed lock FOR UPDATE through
  -- _fan_in_lock_rows. The caller is UNPARENTED (so the parent skip does not apply) and sends a
  -- correlation_id on a marker-capable kind, which WOULD retract the marker and WOULD insert an
  -- event row (a FOR KEY SHARE on the child through the FK). Only the status skip stands between
  -- them. The gate is single-session: it pins the skip's EFFECT (no event row, marker and
  -- metadata untouched), not the absence of a lock wait. The RAISE WARNING the helper emits on
  -- a retraction (review WR-02) is not asserted: plpgsql cannot capture a WARNING without a
  -- psql-level parse, and the retraction itself is asserted by SITE-A, SITE-B and the kind arms.
  -- RED-UNDER: replace the helper's `IF v_status = 'done_pending_children' THEN` test with
  --            `IF FALSE THEN`. The enqueue still dedups and returns the fan-in child's id, so
  --            a one-job-one-id check stays green, but the helper now retracts the child's
  --            marker and inserts an event row, taking the KEY SHARE on a row the ancestor-first
  --            protocol orders. Every earlier arm seeds a `pending` job, so none of them sees
  --            it and this arm is the first failure.
  -- RED-UNDER-M: {"arm":"DPC-SKIP","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"  IF v_status = 'done_pending_children' THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  v_sent := jsonb_build_object('correlation_id', 'c-dpc-skip');
  v_seed_meta := jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', v_enq_at);
  v_strat := pg_temp.dd_seed('derive_broker_dailies', 'done_pending_children', v_seed_meta);
  v_seed := pg_temp.dd_job(v_strat, 'derive_broker_dailies');

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'derive_broker_dailies', v_sent);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (DPC-SKIP): the enqueue raised SQLSTATE % (message: %)', v_state, v_msg;
  END IF;
  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (DPC-SKIP): the enqueue returned % but the in-flight fan-in child is % (the dedup must still hand back the existing id)', v_ret, v_seed;
  END IF;
  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_seed);
  IF v_m IS DISTINCT FROM v_seed_meta THEN
    RAISE EXCEPTION 'TEST FAILED (DPC-SKIP): the fan-in child''s metadata is % after an unparented caller deduped onto it, expected the seeded % (the marker must stay)', v_m, v_seed_meta;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (DPC-SKIP): % compute_job_dedup_events rows name the fan-in child after an unparented dedup (expected 0: the helper must stay off rows the ancestor-first protocol locks FOR UPDATE)', v_n;
  END IF;

  -- ===== ARM EMPTY-META - NULL, empty and non-object metadata record nothing =====
  -- D11-11: three calls on one unmarked in-flight job. None may raise, change the row or
  -- write an event.
  -- RED-UNDER: delete the `p_metadata = '{}'::jsonb` clause from the helper's early return.
  --            The empty-object call is then recorded as an event with no information in it
  --            (the NULL and non-object calls stay skipped by the typeof test).
  -- RED-UNDER-M: {"arm":"EMPTY-META","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"     OR p_metadata = '{}'::jsonb THEN","replace":"     THEN","occurrences":1}]}
  v_strat := pg_temp.dd_seed('derive_broker_dailies', 'pending', jsonb_build_object('enqueued_at', v_enq_at));
  v_seed := pg_temp.dd_job(v_strat, 'derive_broker_dailies');
  v_seed_meta := jsonb_build_object('enqueued_at', v_enq_at);

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'derive_broker_dailies', NULL);
  SELECT o_ret, o_state, o_msg INTO v_ret2, v_state2, v_msg2
    FROM pg_temp.dd_call(v_strat, 'derive_broker_dailies', '{}'::jsonb);
  SELECT o_ret, o_state, o_msg INTO v_ret3, v_state3, v_msg3
    FROM pg_temp.dd_call(v_strat, 'derive_broker_dailies', '[1,2]'::jsonb);

  IF v_state IS NOT NULL OR v_state2 IS NOT NULL OR v_state3 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (EMPTY-META): an enqueue with NULL, empty or non-object metadata raised (NULL: % %; empty: % %; array: % %)', v_state, v_msg, v_state2, v_msg2, v_state3, v_msg3;
  END IF;
  IF v_ret IS DISTINCT FROM v_seed OR v_ret2 IS DISTINCT FROM v_seed OR v_ret3 IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (EMPTY-META): the three calls returned %, %, % but the in-flight job is %', v_ret, v_ret2, v_ret3, v_seed;
  END IF;
  v_m := (SELECT metadata FROM public.compute_jobs WHERE id = v_seed);
  IF v_m IS DISTINCT FROM v_seed_meta THEN
    RAISE EXCEPTION 'TEST FAILED (EMPTY-META): the job''s metadata is % after the three calls, expected the seeded %', v_m, v_seed_meta;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (EMPTY-META): % compute_job_dedup_events rows were written for NULL, empty and non-object metadata (expected 0)', v_n;
  END IF;

  -- ===== ARM OVERSIZE - an oversize payload is recorded as its size and never fails ==
  -- D11-11: the side table's CHECK refuses metadata over 8192 bytes. The helper turns an
  -- oversize payload into {"oversize_bytes": n} first, so the enqueue still succeeds.
  -- RED-UNDER: replace the helper's oversize CASE with plain `p_metadata`. The size CHECK
  --            then refuses the INSERT and the enqueue itself raises: a dedup that used to
  --            succeed now fails on a large caller payload.
  -- RED-UNDER-M: {"arm":"OVERSIZE","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"CASE WHEN v_bytes > 8192 THEN jsonb_build_object('oversize_bytes', v_bytes) ELSE p_metadata END","replace":"p_metadata","occurrences":1}]}
  v_sent := jsonb_build_object('correlation_id', 'c-oversize', 'blob', repeat('x', 9000));
  v_strat := pg_temp.dd_seed('process_key_long', 'pending', jsonb_build_object('enqueued_at', v_enq_at));
  v_seed := pg_temp.dd_job(v_strat, 'process_key_long');

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'process_key_long', v_sent);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OVERSIZE): the enqueue raised SQLSTATE % (message: %) on an oversize caller payload; a dedup must never fail on the recording', v_state, left(v_msg, 200);
  END IF;
  IF v_ret IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (OVERSIZE): the enqueue returned % but the in-flight job is %', v_ret, v_seed;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (OVERSIZE): % compute_job_dedup_events rows name the job (expected exactly 1)', v_n;
  END IF;
  SELECT caller_metadata INTO v_cm FROM public.compute_job_dedup_events WHERE job_id = v_seed;
  IF v_cm IS DISTINCT FROM jsonb_build_object('oversize_bytes', octet_length(v_sent::text)) THEN
    RAISE EXCEPTION 'TEST FAILED (OVERSIZE): the recorded caller_metadata is % but expected {"oversize_bytes": %}', left(v_cm::text, 200), octet_length(v_sent::text);
  END IF;

  -- ===== ARM FRESH-INSERT - only a dedup records; a fresh insert writes nothing ====
  -- D11-1: the helper is for an enqueue that deduped onto an existing job. A call that
  -- inserts its own new job already put its metadata on that row, so recording it as well
  -- would double-write and make the event table a log of every enqueue.
  -- RED-UNDER: insert a `PERFORM public._record_enqueue_dedup(v_new_id, p_kind, p_metadata,
  --            p_parent_job_ids);` after the 10-argument overload's fresh-insert
  --            `IF v_new_id IS NOT NULL THEN` line (the second of the two such lines in the
  --            migration). Every fresh enqueue then writes an event row naming its own new job.
  -- RED-UNDER-M: {"arm":"FRESH-INSERT","apply":[{"kind":"insert-after","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","anchor":"IF v_new_id IS NOT NULL THEN","text":"\n    PERFORM public._record_enqueue_dedup(v_new_id, p_kind, p_metadata, p_parent_job_ids);","occurrences":2,"nth":2}]}
  v_sent  := jsonb_build_object('correlation_id', 'c-fresh');
  v_strat := pg_temp.dd_strat();

  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'derive_broker_dailies', v_sent);

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FRESH-INSERT): the enqueue raised SQLSTATE % (message: %)', v_state, v_msg;
  END IF;
  IF v_ret IS NULL OR NOT EXISTS (SELECT 1 FROM public.compute_jobs
                                   WHERE id = v_ret AND strategy_id = v_strat AND status = 'pending') THEN
    RAISE EXCEPTION 'TEST FAILED (FRESH-INSERT): the enqueue returned % and no pending job of this strategy has that id (a fresh insert must create and return a new job)', v_ret;
  END IF;
  SELECT count(*) INTO v_n FROM public.compute_job_dedup_events WHERE job_id = v_ret;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (FRESH-INSERT): % compute_job_dedup_events rows name a job this call inserted itself (expected 0: only a dedup records)', v_n;
  END IF;

  -- ===== ARM ACL-HELPER - the helper is a hardened service-role-only definer ======
  -- Absence is an EXCEPTION, never a skip: merging supabase/migrations/** applies to
  -- PRODUCTION with no human stop.
  -- RED-UNDER: on the live database, after the migration (and its own catalogue verify) has
  --            applied, GRANT EXECUTE on _record_enqueue_dedup(uuid, text, jsonb, uuid[]) TO
  --            authenticated: a SECURITY DEFINER writer of the side table and, through the
  --            retraction, of compute_jobs.metadata becomes callable through PostgREST by
  --            any signed-in user. A post-apply `sql` step, because an edit widening the
  --            GRANT would trip the migration's own verify block during the apply and the
  --            gate would never run.
  -- RED-UNDER-M: {"arm":"ACL-HELPER","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public._record_enqueue_dedup(uuid, text, jsonb, uuid[]) TO authenticated"}]}
  v_oid := to_regprocedure('public._record_enqueue_dedup(uuid,text,jsonb,uuid[])');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-HELPER): public._record_enqueue_dedup(uuid, text, jsonb, uuid[]) does not exist - this gate has nothing to test and must not skip';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-HELPER): _record_enqueue_dedup is not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog') THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-HELPER): _record_enqueue_dedup does not pin search_path to public, pg_catalog';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-HELPER): service_role lacks EXECUTE on _record_enqueue_dedup';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-HELPER): anon can EXECUTE _record_enqueue_dedup';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-HELPER): authenticated can EXECUTE _record_enqueue_dedup';
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-HELPER): PUBLIC still holds EXECUTE on _record_enqueue_dedup';
  END IF;

  -- ===== ARM TABLE - the side table is RLS-enabled, deny-all and service-role-read-only ==
  -- RLS is ENABLEd and deliberately not FORCEd: the SECURITY DEFINER writer runs as the
  -- owner, and FORCE would subject it to the deny-all policy and abort every dedup.
  -- RED-UNDER: on the live database, after the migration has applied, GRANT SELECT on
  --            compute_job_dedup_events TO authenticated. The deny-all policy still hides
  --            every row, but the grant layer is the only control over the RLS-exempt verbs
  --            and an unreviewed client grant on a table of caller metadata is exactly what
  --            the REVOKE ALL exists to prevent. A post-apply `sql` step, as for ACL-HELPER.
  -- RED-UNDER-M: {"arm":"TABLE","apply":[{"kind":"sql","stmt":"GRANT SELECT ON TABLE public.compute_job_dedup_events TO authenticated"}]}
  v_rel := to_regclass('public.compute_job_dedup_events');
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (TABLE): public.compute_job_dedup_events does not exist - this gate has nothing to test and must not skip';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = v_rel) THEN
    RAISE EXCEPTION 'TEST FAILED (TABLE): row level security is not enabled on compute_job_dedup_events';
  END IF;
  IF (SELECT c.relforcerowsecurity FROM pg_class c WHERE c.oid = v_rel) THEN
    RAISE EXCEPTION 'TEST FAILED (TABLE): row level security is FORCED on compute_job_dedup_events, which subjects the SECURITY DEFINER writer to the deny-all policy and aborts every dedup that records';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policy WHERE polrelid = v_rel;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (TABLE): % policies exist on compute_job_dedup_events (expected exactly the one deny-all policy)', v_n;
  END IF;
  SELECT polname, polcmd::text AS polcmd, pg_get_expr(polqual, polrelid) AS q,
         pg_get_expr(polwithcheck, polrelid) AS w INTO v_pol
    FROM pg_policy WHERE polrelid = v_rel;
  IF v_pol.polname IS DISTINCT FROM 'compute_job_dedup_events_deny_all'
     OR v_pol.polcmd IS DISTINCT FROM '*'
     OR v_pol.q IS DISTINCT FROM 'false'
     OR v_pol.w IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'TEST FAILED (TABLE): the policy on compute_job_dedup_events is %, not compute_job_dedup_events_deny_all FOR ALL USING (false) WITH CHECK (false)', to_jsonb(v_pol);
  END IF;
  SELECT string_agg(COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type,
                    ',' ORDER BY COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type)
    INTO v_privs
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    LEFT JOIN pg_roles r ON r.oid = acl.grantee
   WHERE c.oid = v_rel
     AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
  IF v_privs IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (TABLE): PUBLIC, anon or authenticated hold table-level privileges "%" on compute_job_dedup_events, expected NONE', v_privs;
  END IF;
  IF NOT has_table_privilege('service_role', v_rel, 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (TABLE): service_role lacks SELECT on compute_job_dedup_events (operators read the audit trail through it)';
  END IF;
  IF has_table_privilege('service_role', v_rel, 'INSERT')
     OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') THEN
    RAISE EXCEPTION 'TEST FAILED (TABLE): service_role holds INSERT, UPDATE or DELETE on compute_job_dedup_events; the only writer is the SECURITY DEFINER helper';
  END IF;

  -- ===== ARM BODY-PIN - both overloads carry both call sites, the helper reuses the marker UPDATE ==
  -- D11-12 / D11-13. The 7-argument overload is UNREACHABLE: every 7-argument call is
  -- ambiguous (42725) against the 10-argument overload's defaults, so no behavioural arm can
  -- exercise it and its proof is a body pin. The definitions are read through
  -- pg_get_functiondef with both comment syntaxes stripped in ONE left-to-right pass, so a
  -- call that survives only in a comment does not count.
  -- LAST ARM: the SITE-A, SITE-B and FRESH-INSERT twins all change the 10-arg call count read
  -- here, and each of those arms must fail first.
  -- RED-UNDER: delete the `SITE A (7-arg)` helper call from the migration. The 7-argument
  --            overload then dedups without recording or retracting and nothing behavioural
  --            can see it; only the call count of its comment-stripped definition drops
  --            from two to one.
  -- RED-UNDER-M: {"arm":"BODY-PIN","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"    PERFORM public._record_enqueue_dedup(v_existing_id, p_kind, p_metadata, p_parent_job_ids);  -- Phase 211 D11, SITE A (7-arg)\n","replace":"","occurrences":1}]}
  v_oid := to_regprocedure('public._enqueue_compute_job_internal(uuid,uuid,text,text,uuid[],text,jsonb)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): the 7-argument _enqueue_compute_job_internal does not exist - this gate has nothing to test and must not skip';
  END IF;
  v_src := regexp_replace(pg_get_functiondef(v_oid), '--[^\n]*|/\*([^*]|\*+[^*/])*\*+/', '', 'g');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): the 7-argument definition came back NULL, so the count below would pass without reading anything';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, '_record_enqueue_dedup\(', 'g');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): the 7-argument overload calls _record_enqueue_dedup % time(s), expected exactly 2 (SITE A and SITE B)', v_n;
  END IF;

  v_oid := to_regprocedure('public._enqueue_compute_job_internal(uuid,uuid,text,text,uuid[],text,jsonb,uuid,uuid,timestamptz)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): the 10-argument _enqueue_compute_job_internal does not exist - this gate has nothing to test and must not skip';
  END IF;
  v_src := regexp_replace(pg_get_functiondef(v_oid), '--[^\n]*|/\*([^*]|\*+[^*/])*\*+/', '', 'g');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): the 10-argument definition came back NULL, so the count below would pass without reading anything';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, '_record_enqueue_dedup\(', 'g');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): the 10-argument overload calls _record_enqueue_dedup % time(s), expected exactly 2 (SITE A and SITE B)', v_n;
  END IF;

  v_oid := to_regprocedure('public._record_enqueue_dedup(uuid,text,jsonb,uuid[])');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): public._record_enqueue_dedup does not exist - this gate has nothing to test and must not skip';
  END IF;
  v_src := regexp_replace(pg_get_functiondef(v_oid), '--[^\n]*|/\*([^*]|\*+[^*/])*\*+/', '', 'g');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): the helper definition came back NULL, so the counts below would pass without reading anything';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, 'public\.retract_ledger_refresh_marker\(', 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): the helper calls public.retract_ledger_refresh_marker % time(s), expected exactly 1 (one marker list, reused)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, '\mupdate\M', 'gi');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (BODY-PIN): the helper contains % UPDATE statement(s), expected none: it must reuse the retraction function, never write compute_jobs itself', v_n;
  END IF;

  RAISE NOTICE 'ALL 16 ARMS EXECUTED (SITE-A, SITE-B, NO-MERGE, KIND-COMPOSITE, KIND-CSV, MARKED-CALLER, NO-CORRELATION, NON-MARKER-KIND, PARENTED, DPC-SKIP, EMPTY-META, OVERSIZE, FRESH-INSERT, ACL-HELPER, TABLE, BODY-PIN): both return sites retract and record, a dedup merges nothing into the job row, the three marker-capable kinds retract, a marked caller, a caller with no correlation id and a non-marker kind do not, a parented enqueue, a dedup onto a done_pending_children row and NULL, empty or non-object metadata record nothing, an oversize payload is recorded as its size without failing the enqueue, a fresh insert records nothing, the helper and the side table are locked down to service_role, and both overloads carry both call sites while the helper reuses the marker UPDATE.';
END $$;

ROLLBACK;
