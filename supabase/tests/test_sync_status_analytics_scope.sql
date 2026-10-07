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

-- ===== ARM S2 — the Eclipse shape for poll_positions ============================
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_old_fail INTEGER;
  v_old_done INTEGER;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope S2') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, now() - interval '4 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'poll_positions', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '3 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'poll_positions', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '2 hours');

  SELECT count(*) FILTER (WHERE status = 'failed_final'), count(*) FILTER (WHERE status = 'done')
    INTO v_old_fail, v_old_done
    FROM compute_jobs WHERE strategy_id = s AND kind = 'poll_positions';
  IF v_old_fail <> 2 OR v_old_done <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S2-SETUP): % failed_final and % done poll_positions rows exist before the driving mark, not 2 and 0, so the Eclipse shape for this kind was not seeded.', v_old_fail, v_old_done;
  END IF;

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'poll_positions', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded handler failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (S2-SETUP): the driven poll_positions is % rather than failed_final, so the bridge was never asked to decide this side-kind failure.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: 'poll_positions' dropped from the closed side list: its failures count again and the row reads failed.
  --            ⚠️ LAYERED: anchor (xv), the exact-set check on the list, is stood down.
  -- RED-UNDER-M: {"arm":"S2","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"       AND f.kind NOT IN ('sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot')\n","replace":"       AND f.kind NOT IN ('sync_funding', 'reconcile_strategy', 'compute_intro_snapshot')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (S2): the row reads % after a poll_positions failure that no analytic depends on. poll_positions persists position_snapshots and writes nothing in strategy_analytics, so its failure must not pin the analytics status failed.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM S3 — the Eclipse shape for reconcile_strategy ========================
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_old_fail INTEGER;
  v_old_done INTEGER;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope S3') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, now() - interval '4 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'reconcile_strategy', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '3 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'reconcile_strategy', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '2 hours');

  SELECT count(*) FILTER (WHERE status = 'failed_final'), count(*) FILTER (WHERE status = 'done')
    INTO v_old_fail, v_old_done
    FROM compute_jobs WHERE strategy_id = s AND kind = 'reconcile_strategy';
  IF v_old_fail <> 2 OR v_old_done <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S3-SETUP): % failed_final and % done reconcile_strategy rows exist before the driving mark, not 2 and 0, so the Eclipse shape for this kind was not seeded.', v_old_fail, v_old_done;
  END IF;

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'reconcile_strategy', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded handler failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (S3-SETUP): the driven reconcile_strategy is % rather than failed_final, so the bridge was never asked to decide this side-kind failure.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: 'reconcile_strategy' dropped from the closed side list: its failures count again and the row reads failed.
  --            ⚠️ LAYERED: anchor (xv), the exact-set check on the list, is stood down.
  -- RED-UNDER-M: {"arm":"S3","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"       AND f.kind NOT IN ('sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot')\n","replace":"       AND f.kind NOT IN ('sync_funding', 'poll_positions', 'compute_intro_snapshot')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (S3): the row reads % after a reconcile_strategy failure that no analytic depends on. reconcile_strategy writes reconciliation_reports, portfolio_alerts and trades, and nothing in strategy_analytics, so its failure must not pin the analytics status failed.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM S4 — the Eclipse shape for compute_intro_snapshot ====================
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_old_fail INTEGER;
  v_old_done INTEGER;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope S4') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, now() - interval '4 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'compute_intro_snapshot', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '3 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'compute_intro_snapshot', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '2 hours');

  SELECT count(*) FILTER (WHERE status = 'failed_final'), count(*) FILTER (WHERE status = 'done')
    INTO v_old_fail, v_old_done
    FROM compute_jobs WHERE strategy_id = s AND kind = 'compute_intro_snapshot';
  IF v_old_fail <> 2 OR v_old_done <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S4-SETUP): % failed_final and % done compute_intro_snapshot rows exist before the driving mark, not 2 and 0, so the Eclipse shape for this kind was not seeded.', v_old_fail, v_old_done;
  END IF;

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'compute_intro_snapshot', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded handler failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (S4-SETUP): the driven compute_intro_snapshot is % rather than failed_final, so the bridge was never asked to decide this side-kind failure.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: 'compute_intro_snapshot' dropped from the closed side list: its failures count again and the row reads failed.
  --            ⚠️ LAYERED: anchor (xv), the exact-set check on the list, is stood down.
  -- RED-UNDER-M: {"arm":"S4","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"       AND f.kind NOT IN ('sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot')\n","replace":"       AND f.kind NOT IN ('sync_funding', 'poll_positions', 'reconcile_strategy')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (S4): the row reads % after a compute_intro_snapshot failure that no analytic depends on. compute_intro_snapshot reads strategy_analytics and writes contact_requests, and its strategy_id is only the intro target, so its failure must not pin the analytics status failed.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM S5 — a live stitch_composite failure beside a side failure ===========
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_stitch   INTEGER;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope S5') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, now() - interval '4 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'stitch_composite', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '2 hours');

  SELECT count(*) INTO v_stitch
    FROM compute_jobs
   WHERE strategy_id = s AND kind = 'stitch_composite' AND status = 'failed_final';
  IF v_stitch <> 1 OR EXISTS (SELECT 1 FROM compute_jobs WHERE strategy_id = s AND kind = 'stitch_composite' AND status = 'done') THEN
    RAISE EXCEPTION 'TEST FAILED (S5-SETUP): % failed_final stitch_composite rows (or a done one) exist before the driving mark, so the genuine analytics failure that must stay visible was not seeded.', v_stitch;
  END IF;

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded handler failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (S5-SETUP): the driven sync_funding is % rather than failed_final, so the bridge was never asked to decide beside the stitch failure.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: 'stitch_composite' added to the side list: a genuine composite failure is dropped from the failure set and the row reads complete.
  --            ⚠️ LAYERED: anchors (xv) and (xvi) are stood down.
  -- RED-UNDER-M: {"arm":"S5","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"       AND f.kind NOT IN ('sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot')\n","replace":"       AND f.kind NOT IN ('sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot', 'stitch_composite')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF v_counting_in_side THEN","replace":"IF FALSE AND v_counting_in_side THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (S5): the row reads % beside a live stitch_composite failure. stitch_composite writes strategy_analytics, so its failure is a genuine analytics failure, and a side-kind failure next to it must never launder it.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM S6 — SI-02: a warned row with a side-only failure ====================
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_warned   BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope S6') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete_with_warnings', TRUE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, now() - interval '4 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'sync_funding', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '2 hours');

  SELECT computation_status, computation_warned INTO v_status, v_warned FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' OR v_warned IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (S6-SETUP): the seeded row reads % with computation_warned %, not a warned published row, so the SI-02 edge was not seeded.', COALESCE(v_status, 'NULL'), COALESCE(v_warned::text, 'NULL');
  END IF;

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded handler failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (S6-SETUP): the driven sync_funding is % rather than failed_final, so the bridge was never asked to decide a side-only failure on a warned row.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computation_warned INTO v_status, v_warned FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: branch (c)'s status pick made to yield plain complete for a warned row: the
  --            warning is laundered into a clean success once the side failure no longer
  --            pins failed. No carried count anchor moves (the three computation_warned
  --            reads stay), so the twin is a single edit.
  -- RED-UNDER-M: {"arm":"S6","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"           THEN 'complete_with_warnings'\n           ELSE 'complete'\n         END,\n         computation_error  = NULL,","replace":"           THEN 'complete'\n           ELSE 'complete'\n         END,\n         computation_error  = NULL,","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete_with_warnings' OR v_warned IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (S6): a warned row whose only failure is a side kind reads % with computation_warned %. With the failure gone the bridge reaches branch (c), which must keep complete_with_warnings and the runner-owned warning flag (SI-02); plain complete would publish a warned factsheet as clean.', COALESCE(v_status, 'NULL'), COALESCE(v_warned::text, 'NULL');
  END IF;
END $$;

-- ===== ARM C1 — AI-FX-35: a failed process_key_long cleared by a later done chain ===
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_dsrc     TEXT;
  v_dstat    TEXT;
  v_cstat    TEXT;
  v_later    INTEGER;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope C1') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at, metadata)
  VALUES (s, 'process_key_long', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '6 hours', jsonb_build_object('source', 'mt5'));
  -- The ledger-refresh chain that finished after the failure: a done derive, then a
  -- compute driven done through the real RPC. Both carry the refresh marker, which
  -- the supersession must NOT read.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at, metadata)
  VALUES (s, 'derive_broker_dailies', 'done', 1, 3, now() - interval '5 hours', jsonb_build_object('source', 'ledger-refresh'));
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at, metadata)
  VALUES (s, 'compute_analytics_from_csv', 'running', tok, 1, 3, now() - interval '4 hours', jsonb_build_object('source', 'ledger-refresh'))
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT d.status, d.metadata ->> 'source',
         (SELECT status FROM compute_jobs WHERE id = j),
         (SELECT count(*) FROM compute_jobs c
           WHERE c.strategy_id = s AND c.status = 'done'
             AND c.kind IN ('derive_broker_dailies', 'compute_analytics_from_csv')
             AND c.created_at > (SELECT created_at FROM compute_jobs WHERE strategy_id = s AND kind = 'process_key_long'))
    INTO v_dstat, v_dsrc, v_cstat, v_later
    FROM compute_jobs d WHERE d.strategy_id = s AND d.kind = 'derive_broker_dailies';
  IF v_dstat IS DISTINCT FROM 'done' OR v_dsrc IS DISTINCT FROM 'ledger-refresh' OR v_cstat IS DISTINCT FROM 'done' OR v_later <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (C1-SETUP): derive is % (source %), compute is %, and % chain job(s) are done later than the failure, not a done ledger-refresh derive plus a done compute, so the AI-FX-35 shape was not seeded.', COALESCE(v_dstat, 'NULL'), COALESCE(v_dsrc, 'NULL'), COALESCE(v_cstat, 'NULL'), v_later;
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: conjunct (2), the process_key_long supersession, deleted: the failed process_key_long counts again and the row reads failed.
  --            ⚠️ LAYERED: anchors (xvii) and (xviii) are stood down.
  -- RED-UNDER-M: {"arm":"C1","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"       AND NOT (\n         f.kind = 'process_key_long'\n         AND EXISTS (\n           SELECT 1\n             FROM compute_jobs c1\n            WHERE c1.strategy_id = f.strategy_id\n              AND c1.kind = 'derive_broker_dailies'\n              AND c1.status = 'done'\n              AND c1.created_at > f.created_at\n         )\n         AND EXISTS (\n           SELECT 1\n             FROM compute_jobs c2\n            WHERE c2.strategy_id = f.strategy_id\n              AND c2.kind = 'compute_analytics_from_csv'\n              AND c2.status = 'done'\n              AND c2.created_at > f.created_at\n         )\n       )\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_d06_clause_ok THEN","replace":"IF FALSE AND NOT v_d06_clause_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF v_pkl_sites <> 1 THEN","replace":"IF FALSE AND v_pkl_sites <> 1 THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (C1): the row reads % although a ledger-refresh derive AND a compute both finished done after the failed process_key_long. That chain re-reads the full history, so it supersedes the failure; leaving the row failed is the AI-FX-35 defect (three finished refresh chains, still failed).', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM C2 — a later compute alone does not clear process_key_long ===========
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_derive   INTEGER;
  v_cstat    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope C2') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'process_key_long', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '6 hours');
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'running', tok, 1, 3, now() - interval '4 hours')
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT count(*) INTO v_derive FROM compute_jobs WHERE strategy_id = s AND kind = 'derive_broker_dailies';
  SELECT status INTO v_cstat FROM compute_jobs WHERE id = j;
  IF v_derive <> 0 OR v_cstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (C2-SETUP): % derive_broker_dailies row(s) exist and the compute is %, not no derive and a done compute, so the compute-only shape was not seeded.', v_derive, COALESCE(v_cstat, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the derive half of the supersession deleted: a later done compute alone clears the failed process_key_long and the row reads complete.
  --            ⚠️ LAYERED: anchor (xvii) is stood down.
  -- RED-UNDER-M: {"arm":"C2","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"         AND EXISTS (\n           SELECT 1\n             FROM compute_jobs c1\n            WHERE c1.strategy_id = f.strategy_id\n              AND c1.kind = 'derive_broker_dailies'\n              AND c1.status = 'done'\n              AND c1.created_at > f.created_at\n         )\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_d06_clause_ok THEN","replace":"IF FALSE AND NOT v_d06_clause_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (C2): the row reads % after only a later compute finished done. D-06 clears a failed process_key_long only when BOTH a later done derive AND a later done compute exist; a compute alone does not prove the full history was re-derived.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM C3 — a later derive alone does not clear process_key_long ============
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_compute  INTEGER;
  v_dstat    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope C3') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'process_key_long', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '6 hours');
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3, now() - interval '5 hours')
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT count(*) INTO v_compute FROM compute_jobs WHERE strategy_id = s AND kind = 'compute_analytics_from_csv';
  SELECT status INTO v_dstat FROM compute_jobs WHERE id = j;
  IF v_compute <> 0 OR v_dstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (C3-SETUP): % compute_analytics_from_csv row(s) exist and the derive is %, not no compute and a done derive, so the derive-only shape was not seeded.', v_compute, COALESCE(v_dstat, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the compute half of the supersession deleted: a later done derive alone clears the failed process_key_long and the row reads complete.
  --            ⚠️ LAYERED: anchor (xvii) is stood down.
  -- RED-UNDER-M: {"arm":"C3","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"         AND EXISTS (\n           SELECT 1\n             FROM compute_jobs c2\n            WHERE c2.strategy_id = f.strategy_id\n              AND c2.kind = 'compute_analytics_from_csv'\n              AND c2.status = 'done'\n              AND c2.created_at > f.created_at\n         )\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_d06_clause_ok THEN","replace":"IF FALSE AND NOT v_d06_clause_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (C3): the row reads % after only a later derive finished done. D-06 clears a failed process_key_long only when BOTH a later done derive AND a later done compute exist; a derive alone leaves the analytics uncomputed.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM C4 — a chain that finished BEFORE the failure does not clear it ======
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_before   INTEGER;
  v_pstat    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope C4') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'derive_broker_dailies', 'done', 1, 3, now() - interval '9 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, now() - interval '8 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'process_key_long', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '6 hours');
  -- An unrelated job driven done afterwards, so the bridge runs over this strategy.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'poll_positions', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT count(*) INTO v_before
    FROM compute_jobs c
   WHERE c.strategy_id = s AND c.status = 'done'
     AND c.kind IN ('derive_broker_dailies', 'compute_analytics_from_csv')
     AND c.created_at < (SELECT created_at FROM compute_jobs WHERE strategy_id = s AND kind = 'process_key_long');
  SELECT status INTO v_pstat FROM compute_jobs WHERE id = j;
  IF v_before <> 2 OR v_pstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (C4-SETUP): % chain job(s) are done BEFORE the failure and the driven poll_positions is %, not 2 and done, so the chain-before-the-failure shape was not seeded.', v_before, COALESCE(v_pstat, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: both created_at comparisons of the supersession deleted: a chain that finished before the failure clears it and the row reads complete.
  --            ⚠️ LAYERED: anchor (xvii) is stood down.
  -- RED-UNDER-M: {"arm":"C4","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"              AND c1.created_at > f.created_at\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"              AND c2.created_at > f.created_at\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_d06_clause_ok THEN","replace":"IF FALSE AND NOT v_d06_clause_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (C4): the row reads % although the derive and compute finished BEFORE the process_key_long failure. A chain that predates the failure re-derived nothing the failed fetch could have changed, so supersession must be strictly later, per failure.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

ROLLBACK;
