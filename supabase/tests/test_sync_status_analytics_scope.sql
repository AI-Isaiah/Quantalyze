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
--   D9            D-09 (founder 2026-10-07): a ten-day-old complete row carrying
--                 the writer-stamped sentence of a real earlier compute failure,
--                 then a nightly sync_funding that fails PERMANENTLY.
--                 computed_at, the sentence and both provenance markers are
--                 unchanged. Without the hold the branch (c) fall-through stamps
--                 computed_at = now() and blanks all three: stale analytics read
--                 freshly updated.
--   D10 (guard)   a ten-day-old failed row, a lingering failed sync_funding, then
--                 a genuine compute created after it driven done: computed_at
--                 advances and the sentence and markers clear. The hold is for
--                 the call a side job FAILED in, not for any strategy that has a
--                 side failure.
--   D11           the founder's named example, a sync_funding TIMEOUT: a TRANSIENT
--                 failure retries failed_retry, failed_retry, failed_final, and
--                 every hop reaches the bridge. computed_at, the sentence, the
--                 markers and the status are unchanged after EACH attempt. D9
--                 drives 'permanent', which never runs the in-flight branch.
--   D12 (guard)   the recency trap: a marked compute created first and still
--                 running, a sync_funding created later that fails fast, then the
--                 compute driven done. The latest-created terminal job is a failed
--                 side job, yet computed_at MUST advance: the hold is keyed on the
--                 job that triggered the call, not on creation order.
--   D13           a failed row that carries a writer sentence stays failed after a
--                 side-only failure (S1..S4 seed failed rows with NO sentence and
--                 still resolve to complete: the stale Eclipse shape).
--   D14           a strategy with no strategy_analytics row gets none from a
--                 side-only failure.
--   D15           CR-R3-01 (founder D-10): a warned row, a genuine compute driven
--                 done while a sync_funding is queued (branch (a) holds the warned
--                 row's stamp), then that sync_funding fails. A counting job reached
--                 done after the stamp, so computed_at advances and the superseded
--                 sentence clears.
--   D16           WR-R3-01 (founder D-10): a sync_funding DEFERRED back to pending,
--                 then the Python DEFERRED path's bridge call naming it as the
--                 trigger, then its later failure. The row is unchanged after both.
-- The completion sentinel at the foot counts these twenty-one sections.
--
-- UNKNOWN KIND, RESOLVED LOUD. An unregistered kind cannot be inserted into
-- compute_jobs at all (the kind column references compute_job_kinds and the
-- kind/target coherence CHECK enumerates the admitted kinds), so a fake-kind arm
-- would be a fabrication. The behavioural proof that "a kind not on the side list
-- counts" is G1 (a registered, unlisted kind) and S5 (stitch_composite); the
-- structural proof is the migration's verify anchor on the list (set equality on
-- the one declared constant v_side_kinds), which RAISES on apply if the list gains,
-- loses or re-spells a literal.
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
  --            is the pre-fix body. ⚠️ LAYERED: anchor (xv-b), the three-read-sites check on
  --            the one declared list, is stood down, otherwise the apply RAISES before the
  --            gate runs.
  -- RED-UNDER-M: {"arm":"S1","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"       AND NOT COALESCE(f.kind = ANY (v_side_kinds), FALSE)\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_sites_ok THEN","replace":"IF FALSE AND NOT v_side_sites_ok THEN","occurrences":1}]}
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
  --            ⚠️ LAYERED: anchors (xv) and (xv-b), the exact-set check on the list and the literal count, are stood down.
  -- RED-UNDER-M: {"arm":"S2","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot'];\n","replace":"ARRAY['sync_funding', 'reconcile_strategy', 'compute_intro_snapshot'];\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_sites_ok THEN","replace":"IF FALSE AND NOT v_side_sites_ok THEN","occurrences":1}]}
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
  --            ⚠️ LAYERED: anchors (xv) and (xv-b), the exact-set check on the list and the literal count, are stood down.
  -- RED-UNDER-M: {"arm":"S3","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot'];\n","replace":"ARRAY['sync_funding', 'poll_positions', 'compute_intro_snapshot'];\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_sites_ok THEN","replace":"IF FALSE AND NOT v_side_sites_ok THEN","occurrences":1}]}
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
  --            ⚠️ LAYERED: anchors (xv) and (xv-b), the exact-set check on the list and the literal count, are stood down.
  -- RED-UNDER-M: {"arm":"S4","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot'];\n","replace":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy'];\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_sites_ok THEN","replace":"IF FALSE AND NOT v_side_sites_ok THEN","occurrences":1}]}
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
  -- RED-UNDER-M: {"arm":"S5","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot'];\n","replace":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot', 'stitch_composite'];\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF v_counting_in_side THEN","replace":"IF FALSE AND v_counting_in_side THEN","occurrences":1}]}
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
  -- RED-UNDER-M: {"arm":"S6","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"           THEN 'complete_with_warnings'\n           ELSE 'complete'\n         END,\n         computation_error  = CASE WHEN v_side_failed_only","replace":"           THEN 'complete'\n           ELSE 'complete'\n         END,\n         computation_error  = CASE WHEN v_side_failed_only","occurrences":1}]}
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

-- ===== ARM G1 — the retired compute_analytics kind still counts =================
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_cnt      INTEGER;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope G1') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, now() - interval '4 hours');
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded handler failure', 'permanent', tok);

  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s AND kind = 'compute_analytics' AND status = 'failed_final';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (G1-SETUP): % failed_final compute_analytics rows exist after the driving mark, not 1, so the retired kind was never decided by the bridge.', v_cnt;
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: 'compute_analytics' added to the side list: a failure of the retired analytics kind is dropped from the failure set and the row reads complete.
  --            ⚠️ LAYERED: anchors (xv) and (xvi) are stood down.
  -- RED-UNDER-M: {"arm":"G1","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot'];\n","replace":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot', 'compute_analytics'];\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF v_counting_in_side THEN","replace":"IF FALSE AND v_counting_in_side THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (G1): the row reads % after a failed compute_analytics. The retired kind is a registered kind that is NOT on the closed side list, so it counts toward failed; a kind that is not named must resolve loud, never silently healthy (D-05).', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM G2 — D-04: a later done chain does not clear a failed sync_trades ====
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_chain    INTEGER;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope G2') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'sync_trades', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '6 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'derive_broker_dailies', 'done', 1, 3, now() - interval '5 hours');
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'running', tok, 1, 3, now() - interval '4 hours')
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT count(*) INTO v_chain
    FROM compute_jobs c
   WHERE c.strategy_id = s AND c.status = 'done'
     AND c.kind IN ('derive_broker_dailies', 'compute_analytics_from_csv')
     AND c.created_at > (SELECT created_at FROM compute_jobs WHERE strategy_id = s AND kind = 'sync_trades');
  IF v_chain <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (G2-SETUP): % chain job(s) are done after the failed sync_trades, not 2, so the shape a widened chain rule would wrongly clear was not seeded.', v_chain;
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the process_key_long scope of the chain rule widened to every kind: the later done chain clears the failed sync_trades and the row reads complete.
  --            ⚠️ LAYERED: anchors (xvii) and (xviii) are stood down (the edit removes the only process_key_long literal).
  -- RED-UNDER-M: {"arm":"G2","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"         f.kind = 'process_key_long'\n","replace":"         TRUE\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_d06_clause_ok THEN","replace":"IF FALSE AND NOT v_d06_clause_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF v_pkl_sites <> 1 THEN","replace":"IF FALSE AND v_pkl_sites <> 1 THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (G2): the row reads % although a failed sync_trades was followed by a done derive and a done compute. D-04: the chain rule is scoped to process_key_long alone; a later done of a DIFFERENT kind never masks a real failure, and sync_trades keeps only its own same-kind supersession.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM G3 — D-04: a done side kind does not clear a genuine compute failure ===
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_jobstat  TEXT;
  v_status   TEXT;
  v_side     TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope G3') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '6 hours');
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT status INTO v_side FROM compute_jobs WHERE id = j;
  IF v_side IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (G3-SETUP): the driven sync_funding is % rather than done, so the later done side-kind job that must not mask the compute failure was not produced.', COALESCE(v_side, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: 'compute_analytics_from_csv' added to the side list: the genuine compute failure is dropped from the failure set and the row reads complete.
  --            ⚠️ LAYERED: anchors (xv) and (xvi) are stood down.
  -- RED-UNDER-M: {"arm":"G3","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot'];\n","replace":"ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot', 'compute_analytics_from_csv'];\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_list_ok THEN","replace":"IF FALSE AND NOT v_side_list_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF v_counting_in_side THEN","replace":"IF FALSE AND v_counting_in_side THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (G3): the row reads % although a genuine compute_analytics_from_csv failure is followed only by a done side-kind job. D-04: a later done of a DIFFERENT kind never masks a real analytics failure.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM D9 — D-09: a failed side-kind job never stamps freshness ============
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  fj         UUID;
  tok        UUID;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_err      TEXT := 'seeded sentence of a real earlier compute failure';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
  v_msg      TEXT;
  v_src      TEXT;
  v_mjob     UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope D9') RETURNING id INTO s;

  -- A real earlier analytics failure (superseded by a later done compute, so it is
  -- no longer live) whose writer-stamped sentence still sits on a ten-day-old
  -- COMPLETE row (the shape branch (b-prime) leaves behind: a sentence over a
  -- terminal-success row).
  -- Both jobs finished BEFORE the row's ten-day-old stamp (updated_at is when a
  -- job became done): the bridge is the only writer of computed_at, so a done
  -- compute later than the stamp would be the CR-R3-01 shape (D15), not this one.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 3, 3, 'seeded failure', 'permanent', v_old_at - interval '2 days', v_old_at - interval '2 days')
  RETURNING id INTO fj;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, v_old_at - interval '1 day', v_old_at - interval '1 day');
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error,
                                  computation_error_source, computation_error_job_id, computed_at)
  VALUES (s, 'complete', FALSE, v_err, 'writer', fj, v_old_at);
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'sync_funding', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '2 hours');

  -- A nightly sync_funding that fails PERMANENTLY now, through the real mark RPC
  -- (a permanent classification goes straight to failed_final; the transient
  -- timeout path, which retries, is D11).
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded permanent failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (D9-SETUP): the driven sync_funding is % rather than failed_final, so the bridge was never asked to decide a side-only failure and the held-column reads below would pass vacuously.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_at, v_msg, v_src, v_mjob
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (D9-SETUP): the row reads % rather than complete after the side-only failure, so the bridge did not reach branch (c) and the held-column reads below would pass vacuously.', COALESCE(v_status, 'NULL');
  END IF;
  -- RED-UNDER: the D-09 flag neutered to FALSE: branch (c) stamps computed_at = now() and blanks
  --            computation_error and both markers over the ten-day-old analytics, i.e. the
  --            pre-D-09 body, so a failing nightly side job makes stale analytics look
  --            freshly updated. No anchor needs standing down: the flag read and the four
  --            CASEs stay intact for (xix); only the value is forced.
  -- RED-UNDER-M: {"arm":"D9","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"                                     AND t.strategy_id = p_strategy_id), FALSE);\n","replace":"                                     AND t.strategy_id = p_strategy_id), FALSE);\n  v_side_failed_only := FALSE;\n","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (D9): computed_at is % after a failed side-kind job, seeded % (ten days old). A side job that failed computed nothing, so it must not stamp the analytics fresh (D-09, founder 2026-10-07).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;
  IF v_msg IS DISTINCT FROM v_err OR v_src IS DISTINCT FROM 'writer' OR v_mjob IS DISTINCT FROM fj THEN
    RAISE EXCEPTION 'TEST FAILED (D9): the earlier failure''s sentence or its provenance markers changed after a failed side-kind job (sentence %, source %, job %). The bridge did not write that sentence, so a side job that failed must not blank it (D-09).', COALESCE(v_msg, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_mjob::text, 'NULL');
  END IF;
END $$;

-- ===== ARM D10 — guard: a genuine compute done after a side failure still stamps ==
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  fj         UUID;
  tok        UUID;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
  v_msg      TEXT;
  v_src      TEXT;
  v_mjob     UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope D10') RETURNING id INTO s;

  -- The same ten-day-old row with an earlier sentence, and a lingering failed
  -- side job that no later done sync_funding ever superseded (the Eclipse shape).
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '8 hours')
  RETURNING id INTO fj;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error,
                                  computation_error_source, computation_error_job_id, computed_at)
  VALUES (s, 'failed', FALSE, 'seeded sentence of a real earlier compute failure', 'writer', fj, v_old_at);
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s, 'sync_funding', 'failed_final', 3, 3, 'handler timeout', 'permanent', now() - interval '2 hours');

  -- A genuine compute, created AFTER the side failure, finishes done now.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (D10-SETUP): the driven compute_analytics_from_csv is % rather than done, so the bridge was never asked to decide after a genuine success.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_at, v_msg, v_src, v_mjob
    FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the D-09 flag forced TRUE: a lingering failed side job freezes computed_at and the
  --            old sentence for good, so a genuine recompute that finishes done never reads
  --            fresh. The hold is for the call a side job FAILED in, not for the strategy.
  --            The flag read and the four CASEs stay intact for (xix); only the value is forced.
  -- RED-UNDER-M: {"arm":"D10","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"                                           AND d.updated_at > sa.computed_at);\n","replace":"                                           AND d.updated_at > sa.computed_at);\n  v_side_failed_only := TRUE;\n","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' OR v_at IS NULL OR v_at <= v_old_at OR v_msg IS NOT NULL OR v_src IS NOT NULL OR v_mjob IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (D10): after a genuine compute finished done (created after the failed sync_funding) the row reads status %, computed_at %, sentence %, markers % / %. Branch (c) must still stamp computed_at and clear the sentence and its markers; D-09 holds them only when the latest terminal job is a failed side-kind job.', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), COALESCE(v_msg, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_mjob::text, 'NULL');
  END IF;
END $$;

-- ===== ARM D11 — a TRANSIENT side failure holds freshness through every retry =====
-- The founder's named example: a nightly sync_funding TIMEOUT. A timeout is
-- classified transient, so it goes running -> failed_retry -> running ->
-- failed_retry -> running -> failed_final (max_attempts 3), and every hop reaches
-- the bridge. D9 drives error_kind 'permanent', which jumps straight to
-- failed_final and never runs the in-flight branch, so it cannot see this path.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  fj         UUID;
  tok        UUID;
  i          INTEGER;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_err      TEXT := 'seeded sentence of a real earlier compute failure';
  v_want     TEXT[] := ARRAY['failed_retry', 'failed_retry', 'failed_final'];
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
  v_msg      TEXT;
  v_src      TEXT;
  v_mjob     UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope D11') RETURNING id INTO s;

  -- Both jobs finished BEFORE the row's ten-day-old stamp (updated_at is when a
  -- job became done): the bridge is the only writer of computed_at, so a done
  -- compute later than the stamp would be the CR-R3-01 shape (D15), not this one.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 3, 3, 'seeded failure', 'permanent', v_old_at - interval '2 days', v_old_at - interval '2 days')
  RETURNING id INTO fj;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, v_old_at - interval '1 day', v_old_at - interval '1 day');
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error,
                                  computation_error_source, computation_error_job_id, computed_at)
  VALUES (s, 'complete', FALSE, v_err, 'writer', fj, v_old_at);

  -- The nightly sync_funding, claimed for the first time.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;

  FOR i IN 1..3 LOOP
    IF i > 1 THEN
      -- The claim RPC's effect, reproduced: the retry is re-claimed running with a
      -- fresh token and its attempt counter advanced.
      tok := gen_random_uuid();
      UPDATE compute_jobs SET status = 'running', claim_token = tok, attempts = i WHERE id = j;
    END IF;
    PERFORM mark_compute_job_failed(j, 'handler timeout', 'transient', tok);

    SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
    IF v_jobstat IS DISTINCT FROM v_want[i] THEN
      RAISE EXCEPTION 'TEST FAILED (D11-SETUP): after transient failure % the sync_funding is % rather than %, so the retry path (failed_retry, failed_retry, failed_final) was not driven and the held-column reads below would pass vacuously.', i, COALESCE(v_jobstat, 'NULL'), v_want[i];
    END IF;

    SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
      INTO v_status, v_at, v_msg, v_src, v_mjob
      FROM strategy_analytics WHERE strategy_id = s;
    -- RED-UNDER: the early return for an in-flight-only side failure deleted: every
    --            failed_retry hop runs branch (a), which stamps computed_at = now()
    --            and blanks the sentence and markers over the ten-day-old analytics.
    --            ⚠️ LAYERED: anchor (xix)'s early-return check is stood down.
  -- RED-UNDER-M: {"arm":"D11","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"  IF v_side_trigger_not_done\n     AND COALESCE(v_nonterminal_count, 0) > 0\n     AND COALESCE(v_nonterminal_counting_count, 1) = 0 THEN\n    RETURN;\n  END IF;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_a_hold_ok THEN","replace":"IF FALSE AND NOT v_a_hold_ok THEN","occurrences":1}]}
    IF v_status IS DISTINCT FROM 'complete' OR v_at IS DISTINCT FROM v_old_at
       OR v_msg IS DISTINCT FROM v_err OR v_src IS DISTINCT FROM 'writer' OR v_mjob IS DISTINCT FROM fj THEN
      RAISE EXCEPTION 'TEST FAILED (D11): after transient sync_funding failure % of 3 (job now %) the row reads status %, computed_at % (seeded % ten days old), sentence %, source %, job %. A side job that timed out computed nothing, so no retry hop may stamp the analytics fresh, blank the sentence of a real earlier failure or move the status (D-09, founder 2026-10-07).', i, v_jobstat, COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at, COALESCE(v_msg, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_mjob::text, 'NULL');
    END IF;
  END LOOP;
END $$;

-- ===== ARM D12 — guard: a counting success after a fast side failure still stamps ==
-- The recency trap. A marked ledger-refresh compute C is created first and is
-- still running; a nightly sync_funding S is created later and fails at once. C
-- then finishes done. The latest-CREATED terminal job is now S (failed_final),
-- yet the call was caused by C succeeding, so computed_at MUST advance. C is
-- marked so that S's failure, with C in flight, leaves the row alone through the
-- refresh keep: the old value survives to the point C is marked.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  c          UUID;
  sj         UUID;
  ctok       UUID := gen_random_uuid();
  stok       UUID := gen_random_uuid();
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope D12') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s, 'complete', FALSE, v_old_at);

  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'running', ctok, 1, 3, '{"source":"ledger-refresh"}'::jsonb, now() - interval '3 hours')
  RETURNING id INTO c;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', stok, 1, 3, now() - interval '2 hours')
  RETURNING id INTO sj;

  PERFORM mark_compute_job_failed(sj, 'seeded permanent failure', 'permanent', stok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = sj;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (D12-SETUP): the driven sync_funding is % rather than failed_final, so the later-created failed side job the recency trap needs does not exist.', COALESCE(v_jobstat, 'NULL');
  END IF;
  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete' OR v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (D12-SETUP): after the side failure with the marked compute still running the row reads % with computed_at % (seeded %), so the old value did not survive to the compute''s own mark and the advance asserted below would hold vacuously.', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;

  PERFORM mark_compute_job_done(c, ctok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = c;
  IF v_jobstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (D12-SETUP): the driven compute_analytics_from_csv is % rather than done, so the bridge was never asked to decide after a genuine success.', COALESCE(v_jobstat, 'NULL');
  END IF;
  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the hold keyed on recency in addition to the trigger (the latest-created
  --            terminal job is a failed_final): the failed side job created AFTER the
  --            compute freezes computed_at when the compute itself finishes done.
  -- RED-UNDER-M: {"arm":"D12","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"                                           AND d.updated_at > sa.computed_at);\n","replace":"                                           AND d.updated_at > sa.computed_at);\n  v_side_failed_only := v_side_failed_only OR COALESCE((SELECT j.status = 'failed_final' FROM compute_jobs j WHERE j.strategy_id = p_strategy_id AND j.status IN ('done', 'failed_final') ORDER BY j.created_at DESC, j.id DESC LIMIT 1), FALSE);\n","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' OR v_at IS NULL OR v_at <= v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (D12): after a genuine compute finished done the row reads status %, computed_at % (seeded % ten days old). The call was caused by a counting job succeeding, so computed_at must advance even though a side job created later had failed; D-09 holds freshness only for a call a side job FAILED in.', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;
END $$;

-- ===== ARM D13 — a failed row that carries a sentence stays failed ================
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  fj         UUID;
  tok        UUID;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_err      TEXT := 'seeded sentence of a real earlier compute failure';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
  v_msg      TEXT;
  v_src      TEXT;
  v_mjob     UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope D13') RETURNING id INTO s;

  -- A real earlier analytics failure, superseded (no longer live), whose writer
  -- sentence still sits on a row that reads FAILED. The sentence is the reason the
  -- row is failed; nothing a side job does can have resolved it.
  -- Both jobs finished BEFORE the row's ten-day-old stamp (updated_at is when a
  -- job became done): the bridge is the only writer of computed_at, so a done
  -- compute later than the stamp would be the CR-R3-01 shape (D15), not this one.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 3, 3, 'seeded failure', 'permanent', v_old_at - interval '2 days', v_old_at - interval '2 days')
  RETURNING id INTO fj;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, v_old_at - interval '1 day', v_old_at - interval '1 day');
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error,
                                  computation_error_source, computation_error_job_id, computed_at)
  VALUES (s, 'failed', FALSE, v_err, 'writer', fj, v_old_at);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded permanent failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (D13-SETUP): the driven sync_funding is % rather than failed_final, so the bridge was never asked to decide a side-only failure.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_at, v_msg, v_src, v_mjob
    FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the failed-row hold deleted from branch (c)'s status CASE: the side-only
  --            failure flips the failed row to complete while its failure sentence is
  --            held, so a failed analytic reads healthy.
  --            ⚠️ LAYERED: anchor (xix)'s status-hold check is stood down.
  -- RED-UNDER-M: {"arm":"D13","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"           WHEN v_side_failed_only\n                AND strategy_analytics.computation_status = 'failed'\n                AND strategy_analytics.computation_error IS NOT NULL\n           THEN 'failed'\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_c_status_hold_ok THEN","replace":"IF FALSE AND NOT v_c_status_hold_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' OR v_at IS DISTINCT FROM v_old_at
     OR v_msg IS DISTINCT FROM v_err OR v_src IS DISTINCT FROM 'writer' OR v_mjob IS DISTINCT FROM fj THEN
    RAISE EXCEPTION 'TEST FAILED (D13): after a failed side-kind job the failed row reads status % (expected failed), computed_at % (seeded %), sentence %, source %, job %. A side job that failed resolved nothing, so a failed row that carries a failure sentence must stay failed (D-09).', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at, COALESCE(v_msg, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_mjob::text, 'NULL');
  END IF;
END $$;

-- ===== ARM D14 — no strategy_analytics row is written for a side-only failure ======
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_before   INTEGER;
  v_after    INTEGER;
  v_jobstat  TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope D14') RETURNING id INTO s;

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, now() - interval '4 hours');
  SELECT count(*) INTO v_before FROM strategy_analytics WHERE strategy_id = s;
  IF v_before <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D14-SETUP): % strategy_analytics row(s) exist before the driving mark, not 0, so the no-row shape was not seeded.', v_before;
  END IF;

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded permanent failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (D14-SETUP): the driven sync_funding is % rather than failed_final, so the bridge was never asked to decide a side-only failure.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT count(*) INTO v_after FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the no-row guard deleted from branch (c): the side-only failure INSERTs a
  --            fresh complete row stamped now(), i.e. analytics that were never computed
  --            read freshly computed.
  --            ⚠️ LAYERED: anchor (xix)'s row-guard check is stood down.
  -- RED-UNDER-M: {"arm":"D14","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"  IF v_side_failed_only\n     AND NOT EXISTS (SELECT 1 FROM strategy_analytics WHERE strategy_id = p_strategy_id) THEN\n    RETURN;\n  END IF;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_c_row_guard_ok THEN","replace":"IF FALSE AND NOT v_c_row_guard_ok THEN","occurrences":1}]}
  IF v_after <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D14): a side-only failure on a strategy with no strategy_analytics row left % row(s). The bridge must not manufacture a fresh complete row stamped now() for analytics that were never computed (D-09).', v_after;
  END IF;
END $$;

-- ===== ARM D15 — a genuine recompute on a warned row is stamped by the side failure that follows it ==
-- Review round 3, CR-R3-01 (founder D-10). A warned row (complete_with_warnings,
-- the majority shape of the published ledger cohort) carries a ten-day-old
-- computed_at. A genuine compute C finishes done while the nightly sync_funding S
-- is still QUEUED, so C's own mark runs branch (a), which holds computed_at on a
-- warned row by design and leaves the stamp to the terminal call. That terminal
-- call is S failing. The trigger is a failed side job, but a counting job reached
-- done after the row's stamp: something else moved the row, so D-09's hold does
-- not apply and computed_at must advance.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  c          UUID;
  sj         UUID;
  fj         UUID;
  ctok       UUID := gen_random_uuid();
  stok       UUID := gen_random_uuid();
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_err      TEXT := 'seeded sentence of a real earlier compute failure';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
  v_msg      TEXT;
  v_src      TEXT;
  v_mjob     UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope D15') RETURNING id INTO s;

  -- An earlier failure and the done compute that superseded it, both finished
  -- before the ten-day-old stamp, whose writer sentence still sits on the warned row.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 3, 3, 'seeded failure', 'permanent', v_old_at - interval '2 days', v_old_at - interval '2 days')
  RETURNING id INTO fj;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, v_old_at - interval '1 day', v_old_at - interval '1 day');
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error,
                                  computation_error_source, computation_error_job_id, computed_at)
  VALUES (s, 'complete_with_warnings', TRUE, v_err, 'writer', fj, v_old_at);

  -- The genuine recompute, running, and the nightly sync_funding, queued behind it.
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'running', ctok, 1, 3, now() - interval '1 hour')
  RETURNING id INTO c;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'pending', 0, 3, now() - interval '30 minutes')
  RETURNING id INTO sj;

  PERFORM mark_compute_job_done(c, ctok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = c;
  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s;
  IF v_jobstat IS DISTINCT FROM 'done' OR v_status IS DISTINCT FROM 'complete_with_warnings' OR v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (D15-SETUP): after the genuine compute''s own mark (job %) with the sync_funding queued the row reads % with computed_at % (seeded %). Branch (a) was expected to hold the warned row and its stamp, which is the state that leaves the stamp owed to the side job''s terminal call; without it the advance asserted below would hold vacuously.', COALESCE(v_jobstat, 'NULL'), COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;

  -- The claim RPC's effect, reproduced, then the side job fails.
  UPDATE compute_jobs SET status = 'running', claim_token = stok, attempts = 1 WHERE id = sj;
  PERFORM mark_compute_job_failed(sj, 'handler timeout', 'permanent', stok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = sj;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (D15-SETUP): the driven sync_funding is % rather than failed_final, so the terminal call this arm is about was never made.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_at, v_msg, v_src, v_mjob
    FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the counting-done release deleted: the hold is keyed on the trigger alone,
  --            so the sync_funding failure keeps the ten-day-old computed_at and the
  --            superseded sentence over a recompute that genuinely finished done.
  --            ⚠️ LAYERED: anchor (xix-c), the release as one whole expression, and anchor
  --            (xv-b), whose read count of the side-kind constant drops to three, are
  --            stood down.
  -- RED-UNDER-M: {"arm":"D15","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"  v_side_failed_only := v_side_failed_only\n                        AND NOT EXISTS (SELECT 1\n                                          FROM compute_jobs d\n                                          JOIN strategy_analytics sa ON sa.strategy_id = d.strategy_id\n                                         WHERE d.strategy_id = p_strategy_id\n                                           AND d.status = 'done'\n                                           AND NOT COALESCE(d.kind = ANY (v_side_kinds), FALSE)\n                                           AND d.updated_at > sa.computed_at);\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_release_ok THEN","replace":"IF FALSE AND NOT v_side_release_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_side_sites_ok THEN","replace":"IF FALSE AND NOT v_side_sites_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete_with_warnings' OR v_at IS NULL OR v_at <= v_old_at
     OR v_msg IS NOT NULL OR v_src IS NOT NULL OR v_mjob IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (D15): after a genuine compute finished done with a sync_funding queued, and that sync_funding then failed, the warned row reads status % (expected complete_with_warnings), computed_at % (seeded % ten days old), sentence %, markers % / %. A counting job reached done after the last stamp, so the side failure is not the only thing that moved the row: D-09''s hold does not apply, computed_at must advance and the superseded sentence must clear (CR-R3-01, founder D-10).', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at, COALESCE(v_msg, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_mjob::text, 'NULL');
  END IF;
END $$;

-- ===== ARM D16 — a DEFERRED side job leaves the row alone, and so does its later failure ==
-- Review round 3, WR-R3-01 (founder D-10). A side-kind job that hits the exchange
-- circuit breaker is DEFERRED back to pending, and the Python DEFERRED path then
-- calls the bridge directly, naming that job as the trigger (round 4). The job is
-- in flight and nothing that counts is, so the call computed nothing: the row must
-- not move. Before round 4 the call passed no trigger, ran branch (a) (computing,
-- computed_at = now(), the sentence blanked), and the hold of the job's later
-- failure then kept that stamp. defer_compute_job is not on this lane, so its
-- effect is reproduced (status back to pending, claim cleared, the reason in
-- last_error), the way D11 reproduces the claim RPC.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  sj         UUID;
  fj         UUID;
  stok       UUID := gen_random_uuid();
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_err      TEXT := 'seeded sentence of a real earlier compute failure';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
  v_msg      TEXT;
  v_src      TEXT;
  v_mjob     UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'sscope-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'sscope', 'sscope-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'sscope mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'sscope D16') RETURNING id INTO s;

  -- An earlier failure and the done compute that superseded it, both finished
  -- before the ten-day-old stamp, whose writer sentence still sits on a COMPLETE row.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 3, 3, 'seeded failure', 'permanent', v_old_at - interval '2 days', v_old_at - interval '2 days')
  RETURNING id INTO fj;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', 1, 3, v_old_at - interval '1 day', v_old_at - interval '1 day');
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error,
                                  computation_error_source, computation_error_job_id, computed_at)
  VALUES (s, 'complete', FALSE, v_err, 'writer', fj, v_old_at);

  -- The nightly sync_funding, claimed, then deferred by the circuit breaker.
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', stok, 1, 3, now())
  RETURNING id INTO sj;
  UPDATE compute_jobs
     SET status = 'pending', attempts = 0, next_attempt_at = now() + interval '65 seconds',
         claimed_at = NULL, claimed_by = NULL, claim_token = NULL,
         last_error = 'exchange_cooldown:binance:60s_remaining'
   WHERE id = sj;

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = sj;
  IF v_jobstat IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'TEST FAILED (D16-SETUP): the deferred sync_funding is % rather than pending, so the DEFERRED shape this arm is about was not seeded.', COALESCE(v_jobstat, 'NULL');
  END IF;

  -- The Python DEFERRED path's call, as job_worker.py dispatch makes it since round 4.
  PERFORM sync_strategy_analytics_status(s, sj);

  SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_at, v_msg, v_src, v_mjob
    FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the early return keyed on a FAILED side trigger only (the round 3 body): the
  --            deferred job is pending, so the call runs branch (a), which moves the
  --            complete row to computing, stamps computed_at = now() and blanks the
  --            sentence and its markers over the ten-day-old analytics.
  --            ⚠️ LAYERED: anchor (xix)'s early-return check is stood down.
  -- RED-UNDER-M: {"arm":"D16","apply":[{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"  IF v_side_trigger_not_done\n     AND COALESCE(v_nonterminal_count, 0) > 0\n","replace":"  IF v_side_failed_only\n     AND COALESCE(v_nonterminal_count, 0) > 0\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261009120000_sync_status_analytics_scope.sql","find":"IF NOT v_a_hold_ok THEN","replace":"IF FALSE AND NOT v_a_hold_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' OR v_at IS DISTINCT FROM v_old_at
     OR v_msg IS DISTINCT FROM v_err OR v_src IS DISTINCT FROM 'writer' OR v_mjob IS DISTINCT FROM fj THEN
    RAISE EXCEPTION 'TEST FAILED (D16): after the DEFERRED path''s bridge call for a deferred sync_funding the row reads status %, computed_at % (seeded % ten days old), sentence %, source %, job %. A deferred side job computed nothing, so the call must leave the row exactly as it was (WR-R3-01, D-09/D-10).', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at, COALESCE(v_msg, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_mjob::text, 'NULL');
  END IF;

  -- The deferred job is re-claimed later and fails: the terminal call holds too.
  stok := gen_random_uuid();
  UPDATE compute_jobs SET status = 'running', claim_token = stok, attempts = 1 WHERE id = sj;
  PERFORM mark_compute_job_failed(sj, 'handler timeout', 'permanent', stok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = sj;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (D16-SETUP): the re-claimed sync_funding is % rather than failed_final, so its terminal call was never made.', COALESCE(v_jobstat, 'NULL');
  END IF;
  SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_at, v_msg, v_src, v_mjob
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete' OR v_at IS DISTINCT FROM v_old_at
     OR v_msg IS DISTINCT FROM v_err OR v_src IS DISTINCT FROM 'writer' OR v_mjob IS DISTINCT FROM fj THEN
    RAISE EXCEPTION 'TEST FAILED (D16): after the deferred sync_funding later failed the row reads status %, computed_at % (seeded % ten days old), sentence %, source %, job %. Neither the deferral nor the failure computed anything, so stale analytics must not read freshly updated (WR-R3-01, D-09/D-10).', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at, COALESCE(v_msg, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_mjob::text, 'NULL');
  END IF;
END $$;

-- ===== COMPLETION SENTINEL ==================================================
-- Reached only if every arm above passed. Counts the twenty-one sections the
-- mutation runner counts: the -SETUP sub-arms fold into their parent section.
DO $$
BEGIN
  RAISE NOTICE 'ALL 21 ARMS EXECUTED (S1, S2, S3, S4, S5, S6, C1, C2, C3, C4, G1, G2, G3, D9, D10, D11, D12, D13, D14, D15, D16): [164.6.6.3.4 STATUSBRIDGE] a failed side-kind job (sync_funding, poll_positions, reconcile_strategy, compute_intro_snapshot) never pins strategy_analytics.computation_status failed (S1..S4), while a live stitch_composite failure beside it still does (S5) and a warned row keeps complete_with_warnings (S6); a failed process_key_long is cleared only by a later done derive AND a later done compute, ledger-refresh chains included (C1), never by either alone (C2, C3) nor by a chain that predates the failure (C4); and the per-kind rule holds for everything else: the retired compute_analytics still counts (G1), a done chain does not clear a failed sync_trades (G2), and a done side kind does not clear a genuine compute_analytics_from_csv failure (G3); a failed side-kind job never stamps computed_at or blanks the sentence of a real earlier failure (D9, D-09), also through every retry of a transient failure (D11), while a genuine compute finished done after it still does, even with a side job created later that failed fast (D10, D12); a failed row that carries a sentence stays failed (D13) and no row is manufactured for a strategy that has none (D14); and a genuine recompute on a warned row that finished done while a side job was queued is stamped when that side job then fails (D15), while a deferred side job leaves the row alone, and so does its later failure (D16).';
END $$;

ROLLBACK;
