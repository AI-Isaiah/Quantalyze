-- Test: a strategy's analytics status (strategy_analytics.computation_status,
-- written by sync_strategy_analytics_status) reads `failed` only for a LIVE
-- ANALYTICS failure: a failed side-kind job never pins it, a failed
-- process_key_long is superseded only by a later done follow-on chain, and every
-- other failure keeps the per-kind rule.
-- Guards migration 20261009120000_sync_status_analytics_scope.sql
-- (Phase 164.6.6.3.4 STATUSBRIDGE; decisions D-01, D-02, D-04, D-05, D-06).
--
-- What makes this gate worth having
-- ---------------------------------
-- Two PROD strategies read `failed` with healthy analytics. One carried twelve
-- failed `sync_funding` jobs that no later done `sync_funding` had superseded
-- (the Eclipse shape); the other carried one failed `process_key_long` that three
-- finished ledger-refresh chains (derive then compute) never cleared, because
-- only a same-kind done was accepted (the AI-FX-35 shape). Nothing inside one
-- function call shows either defect: they are only visible by driving the real
-- mark RPC on a real cluster and reading strategy_analytics back, which every arm
-- below does. Every arm seeds its own strategy and its own jobs by INSERT with
-- explicit created_at offsets, so generation order is decided by data and never
-- by the clock. No arm UPDATEs strategy_analytics.
--
-- Arms (S = side kinds, D-02/D-05; C = the process_key_long chain, D-01/D-06;
-- G = guards, D-04/D-05). "old" is the 20261003120000 body, "new" the body of
-- 20261009120000. A guard reads the SAME value on both bodies by design, so only
-- its twin proves it can fail.
--   S1            Eclipse: a failed sync_funding on a row that already reads
--                 `failed`, with two older failed sync_funding jobs and a done
--                 compute behind it. old failed, new complete.
--   S2            the same shape for poll_positions. old failed, new complete.
--   S3            the same shape for reconcile_strategy. old failed, new complete.
--   S4            the same shape for compute_intro_snapshot. old failed, new
--                 complete.
--   S5  (guard)   a live stitch_composite failure beside a side-kind failure
--                 being marked: failed on both. A side kind never launders a
--                 genuine analytics failure that sits next to it.
--   S6            SI-02: a warned row whose only failure is a side kind reads
--                 complete_with_warnings, never complete. old failed, new
--                 complete_with_warnings.
--   C1            AI-FX-35: a failed process_key_long, then a done
--                 derive_broker_dailies and a compute_analytics_from_csv driven
--                 done, both carrying the ledger-refresh marker. old failed, new
--                 not failed (here: complete).
--   C2  (guard)   only a later compute driven done: failed on both.
--   C3  (guard)   only a later derive driven done: failed on both.
--   C4  (guard)   derive and compute finished BEFORE the failure, then an
--                 unrelated job driven done: failed on both (strict, per
--                 failure, ordering).
--   G1  (guard)   the retired compute_analytics kind marked failed: failed on
--                 both. A registered kind that is not on the side list counts.
--   G2  (guard)   D-04: a failed sync_trades followed by a done derive and a
--                 compute driven done stays failed on both. The chain rule is
--                 scoped to process_key_long alone.
--   G3  (guard)   D-04: a genuine compute_analytics_from_csv failure followed by
--                 a side-kind job driven done stays failed on both.
-- The completion sentinel at the foot counts these thirteen sections.
--
-- UNKNOWN KIND, RESOLVED LOUD. An unregistered kind cannot be inserted into
-- compute_jobs at all (the kind column references compute_job_kinds and the
-- kind/target coherence CHECK enumerates the admitted kinds), so a fake-kind arm
-- would be a fabrication. The behavioural proof that "a kind not on the side list
-- counts" is G1 (a registered, unlisted kind) and S5 (stitch_composite); the
-- structural proof is the migration's verify anchor on the list (set equality on
-- the one NOT-IN list), which RAISES on apply if the list gains, loses or
-- re-spells a literal.
--
-- ⭐ ARM 0 (APPLIED-NESS) IS DELIBERATELY OMITTED, for the reason the residue
-- gate gives: this migration adds no catalog object outside the function body, so
-- there is nothing outside the thing under test for an arm 0 to key on. It is
-- not needed either: on a database where 20261009120000 is not in force, S1
-- RAISES (the old body reads failed), so an unapplied migration reads as a named
-- failure, never as a skip.
--
-- ⭐ WHY EVERY IDENTITY CARRIES A DIGIT (S1, not S). `sectionOfIdentity` in
-- scripts/mutation-runner/run.mjs collapses a trailing `-SUFFIX` into its parent
-- section only when a DIGIT precedes it, so `S1-SETUP` is a sub-arm of section S1
-- and is covered by S1's twin.
--
-- ⚠️ The SETUP guards are VACUITY guards ("this fixture actually reached the
-- branch this arm is about"), not claims about the bridge, and are deliberately
-- NOT twinned: a twin for one would have to break PRODUCTION to break a FIXTURE.
-- A SETUP guard firing still names itself, so a failing run says whether the
-- fixture or the claim broke.
--
-- pgTAP is NOT installed. Plain PL/pgSQL DO blocks, RAISE EXCEPTION on failure,
-- no psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed assertion exits
-- non-zero. The whole test rolls back.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_sync_status_analytics_scope.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose red-under claim below carries an
-- adjacent twin object that scripts/mutation-runner executes on every push: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST failure the
-- gate raises to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ EVERY twin that edits the bridge is LAYERED with an edit that stands down
-- the self-verify anchor the migration keeps over that edit. Without the layer
-- the migration's own DO $verify$ block RAISEs, the apply ABORTS, the gate never
-- runs and no arm can be the first failure: the runner then scores a defect, not
-- a bite. A positive anchor is stood down as `IF FALSE AND NOT <boolean> THEN`.
-- ⚠️ The apply list is the residue gate's list (test_sync_status_bridge_residues.sql),
-- copied from that file, with the side-kind registration fixture inserted
-- directly after the compute_jobs targets fixture (the lane's registry lacks the
-- four side kinds, and the compute_jobs.kind FK refuses them with 23503) and
-- 20261009120000 appended LAST. 20260926120000 (the Phase 164.5.2 mark-RPC lock)
-- is deliberately absent, as it is from the residue gate's list: this gate
-- drives the mark RPC of 20260515114555, and the migration's DO block asserts
-- nothing about the mark RPC bodies.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql"]}

BEGIN;

-- ===== ARM S1 — Eclipse: a failed sync_funding on a row that reads failed ===
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_old_fail INTEGER;
  v_old_done INTEGER;
  v_jobstat  TEXT;
  v_status   TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope S1') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  -- The healthy analytics behind the failures, and two older failed side jobs.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, now() - interval '4 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'sync_funding', 'failed_final', 3, 3, 'handler timeout', 'permanent', now() - interval '3 hours'),
         (s, 'sync_funding', 'failed_final', 3, 3, 'handler timeout', 'permanent', now() - interval '2 hours');

  SELECT count(*) FILTER (WHERE status = 'failed_final'), count(*) FILTER (WHERE status = 'done')
    INTO v_old_fail, v_old_done
    FROM compute_jobs WHERE strategy_id = s AND kind = 'sync_funding';
  IF v_old_fail <> 2 OR v_old_done <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S1-SETUP): % failed_final and % done sync_funding rows exist before the driving mark, not 2 and 0, so the Eclipse shape (failures no later done supersedes) was not seeded.', v_old_fail, v_old_done;
  END IF;

  -- The nightly sync_funding that fails now: a REAL running job with a claim
  -- token, marked through the real RPC, which ends in the bridge.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'handler timeout', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (S1-SETUP): the driven sync_funding is % rather than failed_final, so the bridge was never asked to decide a side-kind failure and the status read below would pass vacuously.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: conjunct (1), the closed side-kind list, deleted from the live_failures
  --            CTE: every failed sync_funding counts again and the row reads failed, which
  --            is the pre-fix body. ⚠️ LAYERED: the two list anchors (xv) and (xvi) are
  --            stood down, otherwise the apply RAISES before the gate runs.
  -- RED-UNDER-M: {"arm":"S1","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"       AND f.kind NOT IN ('sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot')\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF v_counting_in_side THEN","replace":"IF FALSE AND v_counting_in_side THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (S1): the row reads % after a sync_funding failure that no analytic depends on. sync_funding writes funding_fees and nothing in strategy_analytics, so its failure must not pin the analytics status failed over healthy analytics (the Eclipse shape).', COALESCE(v_status, 'NULL');
  END IF;
END $$;

ROLLBACK;
