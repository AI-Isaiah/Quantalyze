-- ==========================================================================
-- Phase 164.9.3.1 FANINGRAPH, plan 03 — D-05 / SC-2: deleting `match_decisions`
-- rows never raises a unique violation and never loses an outcome row.
--
-- THE DEFECT. `bridge_outcomes.match_decision_id` references
-- `match_decisions(id)` ON DELETE SET NULL. Deleting a decision makes Postgres
-- run `UPDATE bridge_outcomes SET match_decision_id = NULL` on its outcome rows.
-- That fires `bridge_outcomes_sync_holding_ref_trigger`, whose body writes
-- `NEW.original_holding_ref := NULL` for every row whose decision is NULL, so
-- every orphan keys as (allocator_id, strategy_id, '') on the partial unique
-- index `bridge_outcomes_legacy_per_strategy_holding_when_md_null`. The first
-- orphan takes the slot; the second raises 23505. A single DELETE of two
-- decisions raises it too. Two outcomes for one (allocator, strategy) under two
-- decisions are LAWFUL by design (bridge_outcomes_allocator_match_decision_unique
-- is per decision), so a first-class admin delete turns a lawful state into a
-- forbidden one.
--
-- THE REMEDY THIS FILE ENCODES (CONTEXT "Research clarifications", option Y).
-- A nullable `former_match_decision_id uuid` on bridge_outcomes, recorded by the
-- sync trigger when the decision link goes NULL, and the SAME-named index
-- re-keyed on it: (allocator_id, strategy_id, COALESCE(original_holding_ref, ''),
-- COALESCE(former_match_decision_id, the all-zero uuid)) WHERE
-- match_decision_id IS NULL. Orphans are keyed by the decision they came from, so
-- two orphans can never share a key; born-NULL rows (an owner inserting
-- match_decision_id NULL directly) keep today's key and today's duplicate guard.
-- No outcome row is deleted or merged to make room (D-05).
--
-- PLANNER HARDENING (threat T-164.9.3.1-07). bridge_outcomes carries a table-level
-- INSERT/UPDATE grant to `authenticated` plus the owner policies
-- bridge_outcomes_insert_own and bridge_outcomes_update_own, so an allocator could
-- otherwise write `former_match_decision_id` directly and defeat the born-NULL
-- duplicate guard option Y exists to keep. The column is therefore TRIGGER-OWNED:
-- an INSERT always stores NULL, an UPDATE that keeps match_decision_id NULL keeps
-- the OLD value, attaching a decision clears it, and the trigger also fires on
-- UPDATE OF former_match_decision_id. Arms OD4, OD5, OD6 and OD7 pin that contract.
--
-- RED FIRST. This file is written BEFORE the migration. On a tree without it, OD1
-- raises 23505 naming the index, and OD2, OD4, OD5 and OD6 are RED because the
-- column does not exist. OD3, the born-NULL guard, is GREEN today and must stay
-- GREEN (it is proven able to fail by its plan-08 twin).
--
-- WHERE IT RUNS. One in-transaction `BEGIN; DO $$ ... $$; ROLLBACK;` per arm, no
-- dblink, so the file runs on BOTH lanes: the pg-lane under sql-mutation, on the
-- STAND-IN of scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql,
-- and the local Supabase stack under sql-tests, on the REAL tables. Plain
-- PL/pgSQL, RAISE EXCEPTION on failure, no pgTAP, no psql meta-commands. Every
-- SQLSTATE-bearing statement runs in an inner BEGIN/EXCEPTION block that ONLY
-- captures; every assertion sits after that block (lint R1). Every arm seeds its
-- own allocator and strategies, so no arm reads another arm's rows.
--
-- ARMS.
--   OD1  deleting two decisions whose outcomes share (allocator, strategy) does
--        not raise: three shapes (two holding-sourced decisions on two holdings;
--        a strategy-sourced thumbs_down + thumbs_up pair; one holding under
--        thumbs_up and thumbs_down), each once as ONE multi-row DELETE and once
--        as two sequential DELETEs.
--   OD2  after such a delete every seeded outcome row still exists, reads
--        match_decision_id NULL and original_holding_ref NULL, and carries
--        former_match_decision_id equal to the id of the decision it pointed at.
--        Outcome rows are never deleted or merged (D-05).
--   OD3  the born-NULL guard: two outcome rows with match_decision_id NULL for one
--        (allocator, strategy) still collide, 23505 naming the index. GREEN today
--        and after the migration.
--   OD4  an INSERT that supplies a forged former_match_decision_id for a born-NULL
--        row is ignored by the trigger and still collides (T-164.9.3.1-07).
--   OD5  a direct UPDATE of former_match_decision_id leaves a born-NULL row NULL
--        and leaves a cascade-orphaned row on its recorded decision id.
--   OD6  re-attaching a decision (UPDATE ... SET match_decision_id = <decision>)
--        to a cascade-orphaned row clears former_match_decision_id to NULL.
--   OD7  a VOLUNTARY detach (UPDATE ... SET match_decision_id = NULL while the
--        decision row still exists) stores NULL, not the old decision id, so the
--        row meets the born-NULL duplicate guard (review WR-01): an owner cannot
--        attach any decision id and detach it to escape the guard. Only the
--        ON DELETE SET NULL cascade, where the decision is already gone, records
--        a former id.
--   OD8  an outcome cannot name a match_decisions row that belongs to ANOTHER
--        allocator (round-2 RLS audit): the sync trigger is SECURITY DEFINER and
--        copies the decision's original_holding_ref into the outcome row, so
--        without the ownership check an allocator who knows another tenant's
--        decision id reads that tenant's holding ref through its own row. INSERT and
--        UPDATE ... SET match_decision_id both raise SQLSTATE 42501 with hint
--        cross_allocator_decision, no row names the decision and nothing is copied;
--        the allocator's OWN decision still attaches and copies its own ref.
--   Arms that read the new column first check the catalog for it and raise their
--   own identity when it is absent, so a tree without the migration reports the
--   arm, not a raw 42703.
--
-- Each arm block is wrapped in `-- >>> ARM <id>` / `-- <<< ARM <id>` delimiter
-- lines so a single arm can be run alone (the per-arm RED procedure of
-- 164.9.3.1-03-PLAN.md). Nothing else in this file starts with those prefixes.
--
-- SETUP. The apply list is the compute-job chain of 164.9.3.1-RESEARCH.md
-- "Verified apply list" (fixtures 01, 02, 03, 07, 11, 15, 20, 21, 23, 24, 27, the
-- queue migration, fixtures 04 and 37, then the migrations that last define the
-- enqueue and mark RPCs and the tables they read), followed by fixture 40. The
-- WHOLE chain is used, not the minimal one the cascade alone needs, because the
-- single phase migration also re-bases the compute-job RPCs and its self-verify
-- reads them; the new migration is appended to this list by plan 06. Fixture 23
-- (contact_requests) must precede fixture 40, which references it. The real
-- creating migrations of match_decisions and bridge_outcomes are NOT listed: they
-- do not replay on the lane, which is why fixture 40 exists (lint R5/R6).
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql"]}

-- >>> ARM OD1
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  v_shape   INT;
  v_leg     INT;
  s         UUID;
  d1        UUID;
  d2        UUID;
  o1        UUID;
  o2        UUID;
  v_seeded  INT;
  v_state   TEXT;
  v_msg     TEXT;
  v_cname   TEXT;
  f_where   TEXT;
  f_state   TEXT;
  f_msg     TEXT;
  f_cname   TEXT;
BEGIN
  -- ----- SEED: one allocator ---------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'od1-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'od1', 'od1-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  -- Shapes: 1 = two holding-sourced decisions on two holdings (the PROD-like
  -- shape); 2 = a strategy-sourced thumbs_down + thumbs_up pair; 3 = one holding
  -- under thumbs_up and thumbs_down. Legs: 1 = ONE multi-row DELETE; 2 = two
  -- sequential DELETEs. A fresh strategy per (shape, leg) keeps every pair of
  -- outcomes on its own (allocator, strategy) key.
  FOR v_shape IN 1..3 LOOP
    FOR v_leg IN 1..2 LOOP
      INSERT INTO strategies (user_id, name)
      VALUES (uid, 'od1 shape ' || v_shape || ' leg ' || v_leg) RETURNING id INTO s;

      IF v_shape = 1 THEN
        INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                                     original_strategy_id, original_holding_ref, kind)
        VALUES (uid, s, 'thumbs_up', uid, NULL, 'holding:od1:h1', 'bridge_recommended')
        RETURNING id INTO d1;
        INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                                     original_strategy_id, original_holding_ref, kind)
        VALUES (uid, s, 'thumbs_up', uid, NULL, 'holding:od1:h2', 'bridge_recommended')
        RETURNING id INTO d2;
      ELSIF v_shape = 2 THEN
        INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                                     original_strategy_id, original_holding_ref, kind)
        VALUES (uid, s, 'thumbs_down', uid, s, NULL, 'bridge_recommended')
        RETURNING id INTO d1;
        INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                                     original_strategy_id, original_holding_ref, kind)
        VALUES (uid, s, 'thumbs_up', uid, s, NULL, 'bridge_recommended')
        RETURNING id INTO d2;
      ELSE
        INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                                     original_strategy_id, original_holding_ref, kind)
        VALUES (uid, s, 'thumbs_up', uid, NULL, 'holding:od1:h1', 'bridge_recommended')
        RETURNING id INTO d1;
        INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                                     original_strategy_id, original_holding_ref, kind)
        VALUES (uid, s, 'thumbs_down', uid, NULL, 'holding:od1:h1', 'bridge_recommended')
        RETURNING id INTO d2;
      END IF;

      INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
      VALUES (uid, s, d1, 'rejected', 'other') RETURNING id INTO o1;
      INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
      VALUES (uid, s, d2, 'rejected', 'other') RETURNING id INTO o2;

      SELECT count(*) INTO v_seeded
        FROM bridge_outcomes
       WHERE (id = o1 AND match_decision_id = d1)
          OR (id = o2 AND match_decision_id = d2);
      IF v_seeded <> 2 THEN
        RAISE EXCEPTION 'TEST FAILED (OD1-SETUP): shape %, leg %: the seed did not produce two outcomes linked to their own decisions (found %).', v_shape, v_leg, v_seeded;
      END IF;

      -- ----- CAPTURE the delete(s); assertions sit after the loops (lint R1) --
      IF v_leg = 1 THEN
        v_state := NULL; v_msg := NULL; v_cname := NULL;
        BEGIN
          DELETE FROM public.match_decisions WHERE id IN (d1, d2);
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
          v_state := SQLSTATE; v_msg := SQLERRM;
        END;
        IF f_state IS NULL AND v_state IS NOT NULL THEN
          f_where := 'shape ' || v_shape || ', one multi-row DELETE';
          f_state := v_state; f_msg := v_msg; f_cname := v_cname;
        END IF;
      ELSE
        v_state := NULL; v_msg := NULL; v_cname := NULL;
        BEGIN
          DELETE FROM public.match_decisions WHERE id = d1;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
          v_state := SQLSTATE; v_msg := SQLERRM;
        END;
        IF f_state IS NULL AND v_state IS NOT NULL THEN
          f_where := 'shape ' || v_shape || ', two sequential DELETEs, first statement';
          f_state := v_state; f_msg := v_msg; f_cname := v_cname;
        END IF;

        v_state := NULL; v_msg := NULL; v_cname := NULL;
        BEGIN
          DELETE FROM public.match_decisions WHERE id = d2;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
          v_state := SQLSTATE; v_msg := SQLERRM;
        END;
        IF f_state IS NULL AND v_state IS NOT NULL THEN
          f_where := 'shape ' || v_shape || ', two sequential DELETEs, second statement';
          f_state := v_state; f_msg := v_msg; f_cname := v_cname;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- RED-UNDER: make the sync trigger store `NEW.former_match_decision_id := NULL` where it recorded OLD.match_decision_id, so cascade orphans share a key again;
  --            LAYERED with v_sync_former_anchored stood down.
  -- RED-UNDER-M: {"arm":"OD1","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"NEW.former_match_decision_id := OLD.match_decision_id;","replace":"NEW.former_match_decision_id := NULL;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_sync_former_anchored THEN","replace":"IF FALSE AND NOT v_sync_former_anchored THEN","occurrences":1}]}
  IF f_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD1): deleting match_decisions rows whose outcomes share (allocator, strategy) raised SQLSTATE % on constraint % (message: %) at %. The ON DELETE SET NULL cascade turned a lawful state (two outcomes for one (allocator, strategy) under two decisions) into a forbidden one: every orphan keys as (allocator, strategy, empty holding) on the md-NULL partial unique index.', f_state, f_cname, f_msg, f_where;
  END IF;
END $$;

ROLLBACK;
-- <<< ARM OD1

-- >>> ARM OD2
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  s         UUID;
  d1        UUID;
  d2        UUID;
  o1        UUID;
  o2        UUID;
  v_seeded  INT;
  v_has_col BOOLEAN;
  v_state   TEXT;
  v_msg     TEXT;
  v_present INT;
  v_ok      INT;
BEGIN
  -- ----- SEED: the PROD-like shape (two holding-sourced decisions) ---------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'od2-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'od2', 'od2-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO strategies (user_id, name) VALUES (uid, 'od2 survivors') RETURNING id INTO s;
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                               original_strategy_id, original_holding_ref, kind)
  VALUES (uid, s, 'thumbs_up', uid, NULL, 'holding:od2:h1', 'bridge_recommended')
  RETURNING id INTO d1;
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                               original_strategy_id, original_holding_ref, kind)
  VALUES (uid, s, 'thumbs_up', uid, NULL, 'holding:od2:h2', 'bridge_recommended')
  RETURNING id INTO d2;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s, d1, 'rejected', 'other') RETURNING id INTO o1;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s, d2, 'rejected', 'other') RETURNING id INTO o2;

  SELECT count(*) INTO v_seeded
    FROM bridge_outcomes
   WHERE (id = o1 AND match_decision_id = d1 AND original_holding_ref = 'holding:od2:h1')
      OR (id = o2 AND match_decision_id = d2 AND original_holding_ref = 'holding:od2:h2');
  IF v_seeded <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (OD2-SETUP): the seed did not produce two outcomes linked to their own holding-sourced decisions (found %).', v_seeded;
  END IF;

  -- ----- the column must exist before any statement names it ---------------
  SELECT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.bridge_outcomes'::regclass
                    AND attname = 'former_match_decision_id'
                    AND NOT attisdropped) INTO v_has_col;
  IF NOT v_has_col THEN
    RAISE EXCEPTION 'TEST FAILED (OD2): column public.bridge_outcomes.former_match_decision_id is missing, so an orphaned outcome cannot record which decision it came from. Without it two orphans of one (allocator, strategy) collide on the md-NULL index and the cascade cannot keep both outcome rows.';
  END IF;

  -- ----- CAPTURE the one-statement delete ----------------------------------
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM public.match_decisions WHERE id IN (d1, d2);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD2): the one-statement delete of both decisions raised SQLSTATE % (message: %), so the survivors cannot be judged.', v_state, v_msg;
  END IF;

  SELECT count(*) INTO v_present FROM public.bridge_outcomes WHERE id IN (o1, o2);
  IF v_present <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (OD2): % of the 2 seeded outcome rows survive the decisions'' deletion. Outcome rows are never deleted or merged to make room (D-05).', v_present;
  END IF;

  SELECT count(*) INTO v_ok
    FROM public.bridge_outcomes b
   WHERE (b.id = o1 AND b.match_decision_id IS NULL AND b.original_holding_ref IS NULL
          AND b.former_match_decision_id = d1)
      OR (b.id = o2 AND b.match_decision_id IS NULL AND b.original_holding_ref IS NULL
          AND b.former_match_decision_id = d2);
  -- RED-UNDER: make the sync trigger record a random uuid instead of OLD.match_decision_id (deletes succeed, survivors carry the wrong id);
  --            LAYERED with v_sync_former_anchored stood down.
  -- RED-UNDER-M: {"arm":"OD2","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"NEW.former_match_decision_id := OLD.match_decision_id;","replace":"NEW.former_match_decision_id := gen_random_uuid();","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_sync_former_anchored THEN","replace":"IF FALSE AND NOT v_sync_former_anchored THEN","occurrences":1}]}
  IF v_ok <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (OD2): only % of the 2 surviving outcome rows read match_decision_id NULL, original_holding_ref NULL and former_match_decision_id equal to the id of the decision each pointed at.', v_ok;
  END IF;
END $$;

ROLLBACK;
-- <<< ARM OD2

-- >>> ARM OD3
BEGIN;

DO $$
DECLARE
  uid     UUID := gen_random_uuid();
  s       UUID;
  r1      UUID;
  v_seeded INT;
  v_state TEXT;
  v_msg   TEXT;
BEGIN
  -- ----- SEED: one born-NULL outcome (an owner insert with no decision) ----
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'od3-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'od3', 'od3-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO strategies (user_id, name) VALUES (uid, 'od3 born-null') RETURNING id INTO s;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s, NULL, 'rejected', 'other') RETURNING id INTO r1;

  SELECT count(*) INTO v_seeded
    FROM bridge_outcomes WHERE id = r1 AND match_decision_id IS NULL;
  IF v_seeded <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (OD3-SETUP): the first born-NULL outcome was not inserted with match_decision_id NULL (found %).', v_seeded;
  END IF;

  -- ----- CAPTURE the second born-NULL insert for the same pair -------------
  v_state := NULL; v_msg := NULL;
  BEGIN
    INSERT INTO public.bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
    VALUES (uid, s, NULL, 'rejected', 'timing_wrong');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  -- RED-UNDER: re-key the md-NULL index on `COALESCE(former_match_decision_id, id)` instead of the zero uuid, so born-NULL rows never collide.
  --            This is the guard arm. v_index_key_anchored reads only the column name, so there is no stand-down.
  -- RED-UNDER-M: {"arm":"OD3","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"COALESCE(former_match_decision_id, '00000000-0000-0000-0000-000000000000'::uuid)","replace":"COALESCE(former_match_decision_id, id)","occurrences":1}]}
  IF v_state IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'TEST FAILED (OD3): a second outcome with match_decision_id NULL for the same (allocator, strategy) raised SQLSTATE % (message: %), expected 23505. The md-NULL partial unique index is the only database-level guard against owner-inserted duplicates, which feed the delta cron and the feedback engine.', v_state, v_msg;
  END IF;
  IF v_msg IS NULL OR position('bridge_outcomes_legacy_per_strategy_holding_when_md_null' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (OD3): the 23505 for a duplicate born-NULL outcome does not name bridge_outcomes_legacy_per_strategy_holding_when_md_null (message: %), so some other constraint refused it.', v_msg;
  END IF;
END $$;

ROLLBACK;
-- <<< ARM OD3

-- >>> ARM OD4
BEGIN;

DO $$
DECLARE
  uid     UUID := gen_random_uuid();
  s       UUID;
  r1      UUID;
  v_seeded INT;
  v_state TEXT;
  v_msg   TEXT;
BEGIN
  -- ----- SEED: one born-NULL outcome ---------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'od4-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'od4', 'od4-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO strategies (user_id, name) VALUES (uid, 'od4 forged insert') RETURNING id INTO s;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s, NULL, 'rejected', 'other') RETURNING id INTO r1;

  SELECT count(*) INTO v_seeded
    FROM bridge_outcomes WHERE id = r1 AND match_decision_id IS NULL;
  IF v_seeded <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (OD4-SETUP): the first born-NULL outcome was not inserted with match_decision_id NULL (found %).', v_seeded;
  END IF;

  -- ----- CAPTURE a born-NULL insert that FORGES former_match_decision_id ---
  -- This statement names the column inside the capture block on purpose: on a
  -- tree without the column its 42703 is the observed SQLSTATE of the identity.
  v_state := NULL; v_msg := NULL;
  BEGIN
    INSERT INTO public.bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind,
                                        rejection_reason, former_match_decision_id)
    VALUES (uid, s, NULL, 'rejected', 'timing_wrong', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  -- RED-UNDER: stop the trigger nulling former_match_decision_id on INSERT (the INSERT branch becomes a no-op), so a forged value moves a born-NULL row off its key.
  --            v_sync_owned_anchored reads only the TG_OP token and the OLD copy, so there is no stand-down.
  -- RED-UNDER-M: {"arm":"OD4","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF TG_OP = 'INSERT' THEN\n      NEW.former_match_decision_id := NULL;","replace":"IF TG_OP = 'INSERT' THEN\n      NULL;","occurrences":1}]}
  IF v_state IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'TEST FAILED (OD4): a born-NULL outcome INSERT that supplies a forged former_match_decision_id raised SQLSTATE % (message: %), expected 23505. The column is trigger-owned: an INSERT must store NULL for it, or an owner could dodge the born-NULL duplicate guard by writing a fresh uuid into it (threat T-164.9.3.1-07).', v_state, v_msg;
  END IF;
  IF v_msg IS NULL OR position('bridge_outcomes_legacy_per_strategy_holding_when_md_null' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (OD4): the 23505 for a forged-former born-NULL insert does not name bridge_outcomes_legacy_per_strategy_holding_when_md_null (message: %).', v_msg;
  END IF;
END $$;

ROLLBACK;
-- <<< ARM OD4

-- >>> ARM OD5
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  s_born    UUID;
  s_orphan  UUID;
  d1        UUID;
  r1        UUID;
  o1        UUID;
  v_seeded  INT;
  v_has_col BOOLEAN;
  v_state   TEXT;
  v_msg     TEXT;
  v_former  UUID;
BEGIN
  -- ----- SEED: a born-NULL outcome, and a cascade-orphaned one -------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'od5-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'od5', 'od5-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO strategies (user_id, name) VALUES (uid, 'od5 born-null') RETURNING id INTO s_born;
  INSERT INTO strategies (user_id, name) VALUES (uid, 'od5 orphan') RETURNING id INTO s_orphan;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s_born, NULL, 'rejected', 'other') RETURNING id INTO r1;
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                               original_strategy_id, original_holding_ref, kind)
  VALUES (uid, s_orphan, 'thumbs_up', uid, NULL, 'holding:od5:h1', 'bridge_recommended')
  RETURNING id INTO d1;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s_orphan, d1, 'rejected', 'other') RETURNING id INTO o1;

  SELECT count(*) INTO v_seeded
    FROM bridge_outcomes
   WHERE (id = r1 AND match_decision_id IS NULL)
      OR (id = o1 AND match_decision_id = d1);
  IF v_seeded <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (OD5-SETUP): the seed did not produce one born-NULL outcome and one outcome linked to its decision (found %).', v_seeded;
  END IF;

  -- ----- the column must exist before any statement names it ---------------
  SELECT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.bridge_outcomes'::regclass
                    AND attname = 'former_match_decision_id'
                    AND NOT attisdropped) INTO v_has_col;
  IF NOT v_has_col THEN
    RAISE EXCEPTION 'TEST FAILED (OD5): column public.bridge_outcomes.former_match_decision_id is missing, so there is no trigger-owned column whose direct writes could be checked.';
  END IF;

  -- ----- (a) a direct UPDATE forging the column on a born-NULL row ---------
  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.bridge_outcomes SET former_match_decision_id = gen_random_uuid() WHERE id = r1;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD5): a direct UPDATE of former_match_decision_id on a born-NULL outcome raised SQLSTATE % (message: %); the trigger must quietly revert the write, not refuse the statement.', v_state, v_msg;
  END IF;
  SELECT former_match_decision_id INTO v_former FROM public.bridge_outcomes WHERE id = r1;
  -- RED-UNDER: drop former_match_decision_id from the trigger's UPDATE OF column list, so a direct write of the column never fires the trigger;
  --            LAYERED with v_trigger_cols_anchored stood down.
  -- RED-UNDER-M: {"arm":"OD5","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"BEFORE INSERT OR UPDATE OF match_decision_id, former_match_decision_id\n  ON public.bridge_outcomes","replace":"BEFORE INSERT OR UPDATE OF match_decision_id\n  ON public.bridge_outcomes","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_trigger_cols_anchored THEN","replace":"IF FALSE AND NOT v_trigger_cols_anchored THEN","occurrences":1}]}
  IF v_former IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD5): a direct UPDATE left former_match_decision_id = % on a born-NULL outcome. The column is trigger-owned: a forged value would move the row off the born-NULL key and defeat the duplicate guard (threat T-164.9.3.1-07).', v_former;
  END IF;

  -- ----- (b) the same forgery on a cascade-orphaned row keeps the recorded id
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM public.match_decisions WHERE id = d1;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD5-SETUP): deleting the single decision of the orphan seed raised SQLSTATE % (message: %).', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_seeded FROM public.bridge_outcomes WHERE id = o1 AND match_decision_id IS NULL;
  IF v_seeded <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (OD5-SETUP): the orphan seed does not read match_decision_id NULL after its decision was deleted (found %).', v_seeded;
  END IF;

  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.bridge_outcomes SET former_match_decision_id = gen_random_uuid() WHERE id = o1;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD5): a direct UPDATE of former_match_decision_id on a cascade-orphaned outcome raised SQLSTATE % (message: %); the trigger must quietly revert the write.', v_state, v_msg;
  END IF;
  SELECT former_match_decision_id INTO v_former FROM public.bridge_outcomes WHERE id = o1;
  IF v_former IS DISTINCT FROM d1 THEN
    RAISE EXCEPTION 'TEST FAILED (OD5): a direct UPDATE changed the recorded former_match_decision_id of a cascade-orphaned outcome to % (expected it to stay %, the deleted decision). An UPDATE that keeps match_decision_id NULL must keep the OLD value.', v_former, d1;
  END IF;
END $$;

ROLLBACK;
-- <<< ARM OD5

-- >>> ARM OD6
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  s         UUID;
  d1        UUID;
  d3        UUID;
  o1        UUID;
  v_seeded  INT;
  v_has_col BOOLEAN;
  v_state   TEXT;
  v_msg     TEXT;
  v_md      UUID;
  v_former  UUID;
BEGIN
  -- ----- the column must exist before any statement names it ---------------
  SELECT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.bridge_outcomes'::regclass
                    AND attname = 'former_match_decision_id'
                    AND NOT attisdropped) INTO v_has_col;
  IF NOT v_has_col THEN
    RAISE EXCEPTION 'TEST FAILED (OD6): column public.bridge_outcomes.former_match_decision_id is missing, so re-attaching a decision to an orphaned outcome has nothing to clear.';
  END IF;

  -- ----- SEED: one outcome, orphaned by deleting its (only) decision --------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'od6-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'od6', 'od6-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO strategies (user_id, name) VALUES (uid, 'od6 reattach') RETURNING id INTO s;
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                               original_strategy_id, original_holding_ref, kind)
  VALUES (uid, s, 'thumbs_up', uid, NULL, 'holding:od6:h1', 'bridge_recommended')
  RETURNING id INTO d1;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s, d1, 'rejected', 'other') RETURNING id INTO o1;

  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM public.match_decisions WHERE id = d1;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD6-SETUP): deleting the single decision of the seed raised SQLSTATE % (message: %).', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_seeded FROM public.bridge_outcomes WHERE id = o1 AND match_decision_id IS NULL;
  IF v_seeded <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (OD6-SETUP): the seeded outcome does not read match_decision_id NULL after its decision was deleted (found %).', v_seeded;
  END IF;

  -- ----- a NEW decision for the same allocator and strategy, re-attached ---
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                               original_strategy_id, original_holding_ref, kind)
  VALUES (uid, s, 'thumbs_up', uid, NULL, 'holding:od6:h3', 'bridge_recommended')
  RETURNING id INTO d3;

  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.bridge_outcomes SET match_decision_id = d3 WHERE id = o1;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD6): re-attaching a decision to a cascade-orphaned outcome raised SQLSTATE % (message: %).', v_state, v_msg;
  END IF;

  SELECT match_decision_id, former_match_decision_id INTO v_md, v_former
    FROM public.bridge_outcomes WHERE id = o1;
  IF v_md IS DISTINCT FROM d3 THEN
    RAISE EXCEPTION 'TEST FAILED (OD6): the re-attach did not link the outcome to the new decision (match_decision_id is %).', v_md;
  END IF;
  -- RED-UNDER: remove `NEW.former_match_decision_id := NULL;` from the `match_decision_id IS NOT NULL` branch, so attaching a decision keeps the stale former id.
  --            No anchor reads that line, so there is no stand-down.
  -- RED-UNDER-M: {"arm":"OD6","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"    NEW.original_holding_ref := v_ref;\n    NEW.former_match_decision_id := NULL;","replace":"    NEW.original_holding_ref := v_ref;","occurrences":1}]}
  IF v_former IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD6): after a decision was re-attached, former_match_decision_id is still % instead of NULL. A stale former id would key the row wrongly the next time its decision is deleted.', v_former;
  END IF;
END $$;

ROLLBACK;
-- <<< ARM OD6

-- >>> ARM OD7
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  s_dup     UUID;
  s_solo    UUID;
  d_dup     UUID;
  d_solo    UUID;
  r_born    UUID;
  r_att     UUID;
  r_solo    UUID;
  v_seeded  INT;
  v_state   TEXT;
  v_msg     TEXT;
  v_md      UUID;
  v_former  UUID;
BEGIN
  -- ----- SEED: (dup) a born-NULL outcome and a second outcome ATTACHED to a
  --       decision that really exists, for one (allocator, strategy); (solo)
  --       one attached outcome on a strategy with no sibling.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'od7-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'od7', 'od7-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO strategies (user_id, name) VALUES (uid, 'od7 dup') RETURNING id INTO s_dup;
  INSERT INTO strategies (user_id, name) VALUES (uid, 'od7 solo') RETURNING id INTO s_solo;
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                               original_strategy_id, original_holding_ref, kind)
  VALUES (uid, s_dup, 'thumbs_up', uid, NULL, 'holding:od7:h1', 'bridge_recommended')
  RETURNING id INTO d_dup;
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                               original_strategy_id, original_holding_ref, kind)
  VALUES (uid, s_solo, 'thumbs_up', uid, NULL, 'holding:od7:h2', 'bridge_recommended')
  RETURNING id INTO d_solo;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s_dup, NULL, 'rejected', 'other') RETURNING id INTO r_born;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s_dup, d_dup, 'rejected', 'timing_wrong') RETURNING id INTO r_att;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid, s_solo, d_solo, 'rejected', 'other') RETURNING id INTO r_solo;

  SELECT count(*) INTO v_seeded
    FROM bridge_outcomes
   WHERE (id = r_born AND match_decision_id IS NULL)
      OR (id = r_att  AND match_decision_id = d_dup)
      OR (id = r_solo AND match_decision_id = d_solo);
  IF v_seeded <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (OD7-SETUP): the seed did not produce one born-NULL outcome and two outcomes attached to live decisions (found %).', v_seeded;
  END IF;

  -- ----- (a) a VOLUNTARY detach (the decision still exists) is born-NULL: it
  --       meets the born-NULL duplicate guard (review WR-01).
  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.bridge_outcomes SET match_decision_id = NULL WHERE id = r_att;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  -- RED-UNDER: make the trigger record OLD.match_decision_id on EVERY unlinking UPDATE (the live-decision test becomes `IF FALSE`), so an owner detach keeps the old decision id as the former id.
  --            LAYERED with v_sync_detach_anchored stood down.
  -- RED-UNDER-M: {"arm":"OD7","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF EXISTS (SELECT 1 FROM match_decisions WHERE id = OLD.match_decision_id) THEN","replace":"IF FALSE THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_sync_detach_anchored THEN","replace":"IF FALSE AND NOT v_sync_detach_anchored THEN","occurrences":1}]}
  IF v_state IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'TEST FAILED (OD7): an owner detached an outcome from a decision that still exists (UPDATE ... SET match_decision_id = NULL) while a born-NULL outcome for the same (allocator, strategy) existed, and the statement raised SQLSTATE % (message: %), expected 23505. Only the ON DELETE SET NULL cascade, where the decision row is gone, may record a former decision id; a voluntary detach must become a born-NULL row and meet the duplicate guard, or an owner can attach any decision id and detach it to escape the guard.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none');
  END IF;
  IF v_msg IS NULL OR position('bridge_outcomes_legacy_per_strategy_holding_when_md_null' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (OD7): the 23505 for a voluntary detach does not name bridge_outcomes_legacy_per_strategy_holding_when_md_null (message: %).', v_msg;
  END IF;

  -- ----- (b) with no sibling the same detach succeeds and stores NULL: the
  --       former id is the cascade's, never a client's.
  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.bridge_outcomes SET match_decision_id = NULL WHERE id = r_solo;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD7): detaching the only outcome of a strategy from a live decision raised SQLSTATE % (message: %), expected success.', v_state, v_msg;
  END IF;
  SELECT match_decision_id, former_match_decision_id INTO v_md, v_former
    FROM public.bridge_outcomes WHERE id = r_solo;
  IF v_md IS NOT NULL OR v_former IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD7): after a voluntary detach the outcome reads match_decision_id % and former_match_decision_id % (expected both NULL). The column records a decision only when the cascade removed it.', v_md, v_former;
  END IF;
END $$;

ROLLBACK;
-- <<< ARM OD7

-- >>> ARM OD8
BEGIN;

DO $$
DECLARE
  uid_a     UUID := gen_random_uuid();
  uid_v     UUID := gen_random_uuid();
  s_a       UUID;
  s_v       UUID;
  d_v       UUID;
  d_own     UUID;
  r_born    UUID;
  v_seeded  INT;
  v_state   TEXT;
  v_msg     TEXT;
  v_hint    TEXT;
  v_n       INT;
  v_md      UUID;
  v_ref     TEXT;
  u_state   TEXT;
  u_msg     TEXT;
  u_hint    TEXT;
  o_state   TEXT;
  o_msg     TEXT;
BEGIN
  -- ----- SEED: an attacker allocator (A) and a victim allocator (V). V has a
  --       decision whose holding ref is the secret; A has its own strategy, its
  --       own decision and one born-NULL outcome.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'od8a-' || uid_a::text || '@quantalyze.test', now(), now()),
         (uid_v, '00000000-0000-0000-0000-000000000000',
          'od8v-' || uid_v::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'od8a', 'od8a-' || uid_a::text || '@quantalyze.test', 'allocator'),
         (uid_v, 'od8v', 'od8v-' || uid_v::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO strategies (user_id, name) VALUES (uid_a, 'od8 attacker') RETURNING id INTO s_a;
  INSERT INTO strategies (user_id, name) VALUES (uid_v, 'od8 victim') RETURNING id INTO s_v;
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                               original_strategy_id, original_holding_ref, kind)
  VALUES (uid_v, s_v, 'thumbs_up', uid_v, NULL, 'holding:od8:victim-secret', 'bridge_recommended')
  RETURNING id INTO d_v;
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by,
                               original_strategy_id, original_holding_ref, kind)
  VALUES (uid_a, s_a, 'thumbs_up', uid_a, NULL, 'holding:od8:attacker-own', 'bridge_recommended')
  RETURNING id INTO d_own;
  INSERT INTO bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
  VALUES (uid_a, s_a, NULL, 'rejected', 'other') RETURNING id INTO r_born;

  SELECT count(*) INTO v_seeded
    FROM bridge_outcomes
   WHERE id = r_born AND match_decision_id IS NULL AND original_holding_ref IS NULL;
  IF v_seeded <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (OD8-SETUP): the seed did not produce one born-NULL outcome with no holding ref (found %).', v_seeded;
  END IF;

  -- ----- (a) CAPTURE: A INSERTs an outcome naming V's decision -------------
  v_state := NULL; v_msg := NULL; v_hint := NULL;
  BEGIN
    INSERT INTO public.bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind, rejection_reason)
    VALUES (uid_a, s_v, d_v, 'rejected', 'timing_wrong');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  SELECT count(*) INTO v_n FROM public.bridge_outcomes
   WHERE allocator_id = uid_a AND match_decision_id = d_v;

  -- ----- (b) CAPTURE: A re-points its born-NULL outcome at V's decision ----
  u_state := NULL; u_msg := NULL; u_hint := NULL;
  BEGIN
    UPDATE public.bridge_outcomes SET match_decision_id = d_v WHERE id = r_born;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS u_hint = PG_EXCEPTION_HINT;
    u_state := SQLSTATE; u_msg := SQLERRM;
  END;
  SELECT match_decision_id, original_holding_ref INTO v_md, v_ref
    FROM public.bridge_outcomes WHERE id = r_born;

  -- ----- (c) CAPTURE: the over-refusal control: A attaches ITS OWN decision --
  o_state := NULL; o_msg := NULL;
  BEGIN
    UPDATE public.bridge_outcomes SET match_decision_id = d_own WHERE id = r_born;
  EXCEPTION WHEN OTHERS THEN
    o_state := SQLSTATE; o_msg := SQLERRM;
  END;

  -- RED-UNDER: remove the ownership check from the sync trigger (`IF FOUND AND v_decision_allocator IS DISTINCT FROM NEW.allocator_id THEN` becomes `IF FALSE THEN`), so a decision of another allocator attaches and its holding ref is copied into the caller's row;
  --            LAYERED with v_sync_owner_anchored stood down.
  -- RED-UNDER-M: {"arm":"OD8","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF FOUND AND v_decision_allocator IS DISTINCT FROM NEW.allocator_id THEN","replace":"IF FALSE THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_sync_owner_anchored THEN","replace":"IF FALSE AND NOT v_sync_owner_anchored THEN","occurrences":1}]}
  IF v_state IS DISTINCT FROM '42501' OR v_hint IS DISTINCT FROM 'cross_allocator_decision' OR v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (OD8): an allocator INSERTed an outcome naming a decision that belongs to ANOTHER allocator; the statement raised SQLSTATE % with hint % (message: %) and % outcome row(s) of the caller now name that decision, expected SQLSTATE 42501, hint cross_allocator_decision and no row. The sync trigger is SECURITY DEFINER and copies the decision''s original_holding_ref into the outcome row, so without the ownership check the caller reads another tenant''s holding ref through its own row.', COALESCE(v_state, 'none'), COALESCE(v_hint, 'none'), COALESCE(v_msg, 'none'), v_n;
  END IF;
  IF u_state IS DISTINCT FROM '42501' OR u_hint IS DISTINCT FROM 'cross_allocator_decision'
     OR v_md IS NOT NULL OR v_ref IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD8): an allocator re-pointed its own outcome at a decision of ANOTHER allocator (UPDATE ... SET match_decision_id); the statement raised SQLSTATE % with hint % (message: %) and the row now reads match_decision_id % and original_holding_ref %, expected SQLSTATE 42501, hint cross_allocator_decision and an unchanged row (NULL decision, NULL holding ref). No holding ref of another tenant may be copied.', COALESCE(u_state, 'none'), COALESCE(u_hint, 'none'), COALESCE(u_msg, 'none'), COALESCE(v_md::text, 'NULL'), COALESCE(v_ref, 'NULL');
  END IF;
  IF o_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (OD8): attaching the allocator''s OWN decision to its outcome raised SQLSTATE % (message: %); the ownership check must refuse only a decision of another allocator.', o_state, o_msg;
  END IF;
  SELECT original_holding_ref INTO v_ref FROM public.bridge_outcomes WHERE id = r_born;
  IF v_ref IS DISTINCT FROM 'holding:od8:attacker-own' THEN
    RAISE EXCEPTION 'TEST FAILED (OD8): after the allocator attached its own decision the outcome reads original_holding_ref % (expected holding:od8:attacker-own, the copy the sync trigger exists to make).', COALESCE(v_ref, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM OD8

DO $$ BEGIN RAISE NOTICE 'ALL 8 ARMS EXECUTED (OD1, OD2, OD3, OD4, OD5, OD6, OD7, OD8) and passed — OD1 deleting decisions whose outcomes share (allocator, strategy) never raises, in three shapes and both statement forms; OD2 every outcome survives with a NULL decision, a NULL holding and its former decision id; OD3 two born-NULL outcomes for one pair still collide on the md-NULL index; OD4 a forged former id on INSERT is ignored and still collides; OD5 a direct UPDATE cannot change the trigger-owned former id; OD6 re-attaching a decision clears it; OD7 a voluntary detach from a live decision is born-NULL and meets the duplicate guard; OD8 an outcome cannot name a decision of another allocator, on INSERT or UPDATE, and no foreign holding ref is copied.'; END $$;
