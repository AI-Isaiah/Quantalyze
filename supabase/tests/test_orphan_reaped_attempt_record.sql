-- ==========================================================================
-- Phase 227 JOBLEDGER, plan 07 (MT5D-01): a reaped orphan keeps its cause.
-- Guards migration 20261124120600_orphan_reaped_attempt_record.sql.
--
-- WHAT IS UNDER TEST. The hourly terminalizer retention_compute_jobs_orphaned_running ends
-- a running job as failed_final with error_kind 'orphaned' (arm A: a claim stamp past the
-- 4-hour window; arm B: no claim stamp and a row past 48 hours). That ends an attempt, and
-- its cause lived only on the compute_jobs row, which the 90-day failed-row prune erases.
-- The migration records it with a trigger on the transition, because under the Phase 164.7
-- rule a migration may not re-register the terminalizer's cron job, so the cron body is
-- untouched and this gate never edits it.
--
-- ORACLE DISCIPLINE (inherited from test_retention_orphaned_running.sql). Every arm that
-- needs the terminalizer reads the DEPLOYED command out of cron.job.command by jobname and
-- EXECUTEs it. It never re-types the predicate: a gate that re-implements the predicate
-- passes when the deployed predicate is wrong.
--
-- ARMS, in the order they EXECUTE. The order is LOAD-BEARING: a mutation twin must make ITS
-- OWN arm the first failure, so an arm may only depend on arms listed before it.
--   O1   (arm A) a job running with a claim stamp past the window, token t, attempts 2,
--        claimed_by w1: the real terminalizer ends it failed_final and exactly one ledger
--        row exists with cause_class orphan_reaped, claim_token t, attempt 2, worker_id w1
--        and the terminalizer's own last_error text.
--   O2   (arm B) a job running with NO claim stamp and no claim token, past 48 hours, keyed
--        by api_key_id with a NULL strategy_id (the Phase 230 shape): the real terminalizer
--        reaps it and one orphan_reaped row exists with a NULL claim_token and the api key.
--   O3   (negative control) mark_compute_job_failed ends a running job as failed_final with
--        error_kind permanent: one `error` row and NO orphan_reaped row, so no attempt is
--        recorded twice under a cause it did not have.
--   O4   (shape, from the catalogue) exactly one trigger on compute_jobs calls the function,
--        enabled, AFTER UPDATE OF status only, row level, with a WHEN naming running,
--        failed_final and orphaned; the function is SECURITY DEFINER, search_path pinned and
--        not executable by PUBLIC, anon or authenticated.
--
-- ISOLATION. Seeds are backdated a CENTURY, which sorts ahead of any foreign candidate under
-- the terminalizer's ORDER BY, so a seed wins the 100-row budget without this file touching
-- a row it does not own. Every assertion reads only rows this arm seeded (never a global
-- count). One `BEGIN; DO; ROLLBACK;` block per arm, so the file leaves nothing behind and
-- runs on both lanes (the pg-lane under sql-mutation and the local stack under sql-tests).
-- Capture-then-assert (lint R1): the call that may raise sits in an inner BEGIN/EXCEPTION
-- block that ONLY captures SQLSTATE and SQLERRM, and every `TEST FAILED (<arm>)` raise sits
-- after it, DIRECTLY in the DO body (scripts/mutation-runner/GRAMMAR.md, rule 3c).
--
-- SETUP LIST. test_retention_orphaned_running.sql's list (pg_cron, the terminalizer and its
-- 20260826140000 re-registration) joined to test_compute_job_attempt_failures.sql's list (the
-- ledger table, the latest mark_compute_job_failed and the claim pair), de-duplicated, in
-- dependency order, ending with the ledger migration and then the migration this gate twins.
-- 20260515114555 (claim-token fencing) is excluded for the reason the ledger gate gives
-- (a second, 3-argument claim function); fixture 36 supplies claim_token instead.
-- ==========================================================================

-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql","supabase/migrations/20260720120000_retention_orphaned_running_window_4h.sql","supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826140000_compute_jobs_error_kind_orphaned.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","supabase/migrations/20261124120000_jobledger_attempt_failures.sql","supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql"]}

-- >>> ARM O1
BEGIN;

DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  t          UUID := gen_random_uuid();
  v_command  TEXT;
  v_ancient  TIMESTAMPTZ := now() - interval '100 years';
  v_state    TEXT;
  v_msg      TEXT;
  v_status   TEXT;
  v_kind     TEXT;
  n          INTEGER;
  v_row      JSONB;
  v_ok       BOOLEAN;
BEGIN
  SELECT cj.command INTO v_command FROM cron.job cj WHERE cj.jobname = 'retention_compute_jobs_orphaned_running';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O1-SETUP): the retention_compute_jobs_orphaned_running cron job is not registered while pg_cron is installed, so the real terminalizer cannot be executed. A missing terminalizer is a red gate, never a skip.';
  END IF;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'orp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'orp', 'orp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'orp o1', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'orp o1') RETURNING id INTO s;
  -- Arm A: a claim stamp far past the 4-hour window, attempt 2 of a worker that died.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at, next_attempt_at)
  VALUES (s, 'sync_trades', 'running', 2, 3, t, 'w1', v_ancient, v_ancient) RETURNING id INTO j;

  -- THE ORACLE: run the REAL deployed terminalizer body.
  v_state := NULL; v_msg := NULL;
  BEGIN
    EXECUTE v_command;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O1-SETUP): executing the deployed terminalizer raised SQLSTATE % (message: %), so the reap this arm reads never completed.', v_state, v_msg;
  END IF;
  SELECT cj.status, cj.error_kind INTO v_status, v_kind FROM compute_jobs cj WHERE cj.id = j;
  IF v_status IS DISTINCT FROM 'failed_final' OR v_kind IS DISTINCT FROM 'orphaned' THEN
    RAISE EXCEPTION 'TEST FAILED (O1-SETUP): the deployed terminalizer left the seeded orphan at status % and error_kind % (expected failed_final and orphaned), so there is no reaped attempt for this arm to read.', COALESCE(v_status, 'NULL'), COALESCE(v_kind, 'NULL');
  END IF;
  SELECT count(*) INTO n FROM compute_job_attempt_failures f WHERE f.job_id = j;
  SELECT to_jsonb(f) INTO v_row FROM compute_job_attempt_failures f WHERE f.job_id = j ORDER BY f.attempt, f.recorded_at, f.id LIMIT 1;

  -- ===== ARM O1 - a reaped orphan (arm A) keeps its cause =====
  v_ok := COALESCE(
        n = 1
    AND v_row->>'cause_class' = 'orphan_reaped'
    AND (v_row->>'claim_token')::uuid = t
    AND (v_row->>'attempt')::int = 2
    AND v_row->>'worker_id' = 'w1'
    AND v_row->>'error_kind' = 'orphaned'
    AND (v_row->>'error_text') LIKE 'orphaned_running_reaped:%'
    AND (v_row->>'strategy_id')::uuid = s
    AND v_row->>'kind' = 'sync_trades', FALSE);
  -- RED-UNDER: change the trigger's WHEN literal 'orphaned' to another value in migration 20261124120600, so the terminalizer's transition never fires the trigger and the reaped attempt is recorded nowhere.
  -- RED-UNDER-M: {"arm":"O1","apply":[{"kind":"edit","file":"supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql","find":"AND NEW.error_kind = 'orphaned')\n  EXECUTE FUNCTION","replace":"AND NEW.error_kind = 'orphaned_never')\n  EXECUTE FUNCTION","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql","find":"IF NOT v_orphaned_ok THEN","replace":"IF FALSE AND NOT v_orphaned_ok THEN","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (O1): after the real terminalizer reaped a running job (claim token %, attempts 2, worker w1) the ledger held % row(s), the first reading % (expected exactly one: cause_class orphan_reaped, that claim token, attempt 2, worker_id w1, error_kind orphaned, error_text starting orphaned_running_reaped:, the job''s strategy and kind). A worker death leaves no record once the job row is pruned, so Phase 230 reads a night in which nothing failed.', t, n, COALESCE(v_row::text, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM O1

-- >>> ARM O2
BEGIN;

DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  j          UUID;
  v_command  TEXT;
  v_ancient  TIMESTAMPTZ := now() - interval '100 years';
  v_state    TEXT;
  v_msg      TEXT;
  v_status   TEXT;
  v_kind     TEXT;
  n          INTEGER;
  v_row      JSONB;
  v_ok       BOOLEAN;
BEGIN
  SELECT cj.command INTO v_command FROM cron.job cj WHERE cj.jobname = 'retention_compute_jobs_orphaned_running';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O2-SETUP): the retention_compute_jobs_orphaned_running cron job is not registered while pg_cron is installed, so the real terminalizer cannot be executed. A missing terminalizer is a red gate, never a skip.';
  END IF;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'orp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'orp', 'orp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'orp o2', 'x', TRUE) RETURNING id INTO k;
  -- Arm B: running, never claimed (no stamp, no token), created far past 48 hours, keyed by
  -- api_key_id with no strategy (the derive_broker_dailies shape Phase 230 reads).
  INSERT INTO compute_jobs (api_key_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at, created_at, next_attempt_at)
  VALUES (k, 'derive_broker_dailies', 'running', 1, 3, NULL, NULL, NULL, v_ancient, v_ancient) RETURNING id INTO j;

  v_state := NULL; v_msg := NULL;
  BEGIN
    EXECUTE v_command;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O2-SETUP): executing the deployed terminalizer raised SQLSTATE % (message: %), so the reap this arm reads never completed.', v_state, v_msg;
  END IF;
  SELECT cj.status, cj.error_kind INTO v_status, v_kind FROM compute_jobs cj WHERE cj.id = j;
  IF v_status IS DISTINCT FROM 'failed_final' OR v_kind IS DISTINCT FROM 'orphaned' THEN
    RAISE EXCEPTION 'TEST FAILED (O2-SETUP): the deployed terminalizer left the never-claimed orphan at status % and error_kind % (expected failed_final and orphaned), so there is no reaped attempt for this arm to read.', COALESCE(v_status, 'NULL'), COALESCE(v_kind, 'NULL');
  END IF;
  SELECT count(*) INTO n FROM compute_job_attempt_failures f WHERE f.job_id = j;
  SELECT to_jsonb(f) INTO v_row FROM compute_job_attempt_failures f WHERE f.job_id = j ORDER BY f.attempt, f.recorded_at, f.id LIMIT 1;

  -- ===== ARM O2 - a reaped never-claimed orphan (arm B) keeps its cause, with a NULL token =====
  v_ok := COALESCE(
        n = 1
    AND v_row->>'cause_class' = 'orphan_reaped'
    AND v_row->>'claim_token' IS NULL
    AND (v_row->>'attempt')::int = 1
    AND v_row->>'worker_id' IS NULL
    AND v_row->>'error_kind' = 'orphaned'
    AND (v_row->>'error_text') LIKE 'orphaned_running_reaped: running with no claim stamp%'
    AND (v_row->>'api_key_id')::uuid = k
    AND v_row->>'strategy_id' IS NULL
    AND v_row->>'kind' = 'derive_broker_dailies', FALSE);
  -- RED-UNDER: replace the claim token the trigger copies from the old row with a made-up one when it is NULL, in migration 20261124120600, so the never-claimed arm's record carries a token the job never held.
  -- RED-UNDER-M: {"arm":"O2","apply":[{"kind":"edit","file":"supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql","find":"OLD.attempts, OLD.claim_token, 'orphan_reaped'","replace":"OLD.attempts, COALESCE(OLD.claim_token, '00000000-0000-0000-0000-0000000000aa'::uuid), 'orphan_reaped'","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (O2): after the real terminalizer reaped a running job that was never claimed (no claim stamp, no claim token, older than 48 hours, keyed by api_key_id) the ledger held % row(s), the first reading % (expected exactly one: cause_class orphan_reaped, a NULL claim_token, attempt 1, no worker, error_kind orphaned, the 48-hour error_text, the job''s api key, no strategy). The invariant-violating arm would otherwise leave no record, or a record naming a token no worker held.', n, COALESCE(v_row::text, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM O2

-- >>> ARM O3
BEGIN;

DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  t          UUID := gen_random_uuid();
  v_state    TEXT;
  v_msg      TEXT;
  v_status   TEXT;
  v_kind     TEXT;
  n_error    INTEGER;
  n_orphan   INTEGER;
  v_ok       BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'orp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'orp', 'orp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'orp o3', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'orp o3') RETURNING id INTO s;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at)
  VALUES (s, 'sync_trades', 'running', 1, 3, t, 'w3', now()) RETURNING id INTO j;

  -- A real failure of a running job, ended as failed_final (a permanent error skips retries):
  -- the same running -> failed_final transition the terminalizer makes, by another writer.
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_failed(j, 'O3 permanent failure', 'permanent', t);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O3-SETUP): mark_compute_job_failed raised SQLSTATE % (message: %) on a running job with its own token, so the failure this arm reads never landed.', v_state, v_msg;
  END IF;
  SELECT cj.status, cj.error_kind INTO v_status, v_kind FROM compute_jobs cj WHERE cj.id = j;
  IF v_status IS DISTINCT FROM 'failed_final' OR v_kind IS DISTINCT FROM 'permanent' THEN
    RAISE EXCEPTION 'TEST FAILED (O3-SETUP): mark_compute_job_failed left the job at status % and error_kind % (expected failed_final and permanent), so this arm does not exercise a running to failed_final transition by a writer other than the terminalizer.', COALESCE(v_status, 'NULL'), COALESCE(v_kind, 'NULL');
  END IF;
  SELECT count(*) INTO n_error FROM compute_job_attempt_failures f WHERE f.job_id = j AND f.cause_class = 'error';
  SELECT count(*) INTO n_orphan FROM compute_job_attempt_failures f WHERE f.job_id = j AND f.cause_class = 'orphan_reaped';

  -- ===== ARM O3 - a real failure is recorded once, as an error, never also as a reaped orphan =====
  v_ok := COALESCE(n_error = 1 AND n_orphan = 0, FALSE);
  -- RED-UNDER: drop the error_kind orphaned test from the trigger's WHEN in migration 20261124120600 (with the self-verify clause that names it stood down), so every running to failed_final transition fires the trigger.
  -- RED-UNDER-M: {"arm":"O3","apply":[{"kind":"edit","file":"supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql","find":"AND NEW.error_kind = 'orphaned')\n  EXECUTE FUNCTION","replace":")\n  EXECUTE FUNCTION","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql","find":"IF NOT v_orphaned_ok THEN","replace":"IF FALSE AND NOT v_orphaned_ok THEN","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (O3): a running job failed through mark_compute_job_failed (error_kind permanent) and the ledger holds % error row(s) and % orphan_reaped row(s) for it (expected 1 and 0). A real failure recorded a second time as a reaped orphan gives Phase 230 an attempt with two causes, one of which it did not have.', n_error, n_orphan;
  END IF;
END $$;

ROLLBACK;
-- <<< ARM O3

-- >>> ARM O4
BEGIN;

DO $$
DECLARE
  v_fn       oid := to_regprocedure('public.record_orphan_reaped_attempt()');
  v_tbl      oid := to_regclass('public.compute_jobs');
  v_status_attnum smallint;
  n_trg      INTEGER;
  v_enabled  "char";
  v_tgtype   smallint;
  v_attrs    smallint[];
  v_def      TEXT;
  v_secdef   BOOLEAN;
  v_cfg      TEXT[];
  v_trg_ok   BOOLEAN;
  v_fn_ok    BOOLEAN;
  v_ok       BOOLEAN;
BEGIN
  SELECT a.attnum INTO v_status_attnum FROM pg_attribute a WHERE a.attrelid = v_tbl AND a.attname = 'status' AND NOT a.attisdropped;
  SELECT count(*) INTO n_trg FROM pg_trigger t WHERE t.tgrelid = v_tbl AND t.tgfoid = v_fn AND NOT t.tgisinternal;
  SELECT t.tgenabled, t.tgtype, t.tgattr::int2[], pg_get_triggerdef(t.oid)
    INTO v_enabled, v_tgtype, v_attrs, v_def
    FROM pg_trigger t WHERE t.tgrelid = v_tbl AND t.tgfoid = v_fn AND NOT t.tgisinternal;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg FROM pg_proc p WHERE p.oid = v_fn;

  -- ===== ARM O4 - one enabled, row-level, status-scoped AFTER trigger with a narrow WHEN =====
  -- tgtype bits: 1 row, 2 BEFORE (unset = AFTER), 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE, 64 INSTEAD OF.
  v_trg_ok := COALESCE(
        n_trg = 1
    AND v_enabled = 'O'
    AND (v_tgtype & 1) = 1
    AND (v_tgtype & 2) = 0
    AND (v_tgtype & 4) = 0
    AND (v_tgtype & 8) = 0
    AND (v_tgtype & 16) = 16
    AND (v_tgtype & 32) = 0
    AND (v_tgtype & 64) = 0
    AND cardinality(v_attrs) = 1
    AND v_attrs[array_lower(v_attrs, 1)] = v_status_attnum
    AND position('WHEN' IN v_def) > 0
    AND position('''running''' IN v_def) > 0
    AND position('''failed_final''' IN v_def) > 0
    AND position('''orphaned''' IN v_def) > 0, FALSE);
  v_fn_ok := COALESCE(
        v_secdef IS TRUE
    AND COALESCE(v_cfg, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_catalog']
    AND NOT has_function_privilege('public', v_fn, 'EXECUTE')
    AND NOT has_function_privilege('anon', v_fn, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'), FALSE);
  v_ok := v_trg_ok AND v_fn_ok;
  -- RED-UNDER: change AFTER UPDATE OF status to a plain AFTER UPDATE in migration 20261124120600 (with the self-verify clause that names it stood down), so the trigger watches every column of a hot table.
  -- RED-UNDER-M: {"arm":"O4","apply":[{"kind":"edit","file":"supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql","find":"  AFTER UPDATE OF status ON public.compute_jobs\n  FOR EACH ROW\n  WHEN (","replace":"  AFTER UPDATE ON public.compute_jobs\n  FOR EACH ROW\n  WHEN (","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql","find":"IF NOT v_after_ok THEN","replace":"IF FALSE AND NOT v_after_ok THEN","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (O4): the compute_jobs trigger that calls record_orphan_reaped_attempt reads % trigger(s), enabled %, tgtype %, column list % (status is column %), definition % and the function reads SECURITY DEFINER % with config % (expected exactly one, enabled, an AFTER UPDATE OF status FOR EACH ROW trigger whose WHEN names running, failed_final and orphaned, calling a SECURITY DEFINER function with search_path pinned that PUBLIC, anon and authenticated cannot execute). A trigger that watches every column fires on every compute_jobs update of a hot table.', n_trg, COALESCE(v_enabled::text, 'NULL'), COALESCE(v_tgtype::text, 'NULL'), COALESCE(v_attrs::text, 'NULL'), COALESCE(v_status_attnum::text, 'NULL'), COALESCE(v_def, 'NULL'), COALESCE(v_secdef::text, 'NULL'), COALESCE(v_cfg::text, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM O4

DO $$ BEGIN RAISE NOTICE 'ALL 4 ARMS EXECUTED (O1, O2, O3, O4) and passed - O1 a reaped orphan (arm A) keeps its cause; O2 a reaped never-claimed orphan (arm B) keeps its cause with a NULL token; O3 a real failure is never also recorded as a reaped orphan; O4 the trigger is one enabled, row-level, status-scoped AFTER trigger with a narrow WHEN, on a SECURITY DEFINER function no API role can execute.'; END $$;
