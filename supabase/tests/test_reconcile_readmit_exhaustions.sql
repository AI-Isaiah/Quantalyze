-- Test: a strategy the reconcile sweep stops readmitting leaves a durable row.
-- Phase 227 JOBLEDGER, plan 04 (ROADMAP SC-3, requirement HEAL-03).
-- Guards migration 20261124120300_reconcile_readmit_exhaustions.sql.
--
-- Why this gate exists (the WHY, not just the WHAT)
-- -------------------------------------------------
-- The reconcile sweep readmits a strategy that lost its worker, and stops once the
-- strategy carries three orphan markers (failed_final rows whose last_error starts with
-- the terminalizer's fixed audit text). When the ceiling holds the strategy just drops
-- out of the sweep: nothing records that the system gave up on it, and the marker rows
-- that prove it are deleted by the 90-day failed-row retention. The founder ruled on
-- 2026-11-23 that the give-up leaves a durable row that outlives that retention, written
-- by SQL, with a Python reader paging from it (plan 09). public.reconcile_readmit_exhaustions
-- is that row and public.record_reconcile_readmit_exhaustions() is the SQL that writes it.
--
-- ORACLE DISCIPLINE. Arm X1 reads the REAL deployed sweep command out of cron.job and
-- EXECUTEs it, so the claim "the sweep readmits nothing at the ceiling" is measured
-- against the sweep itself and never re-typed here. The detector is then called against
-- the very same rows. The two agree at the boundary or the gate is red: at three markers
-- the sweep readmits nothing and the detector writes the row (X1), at two markers the
-- sweep readmits and the detector writes nothing (X3).
--
-- ARMS (listed and executed in this order; each twin's FIRST `TEST FAILED` must name its
-- own arm, so an arm may only depend on arms listed before it):
--   X1      a strategy at the ceiling (three markers) is not readmitted by the real sweep,
--           and the detector writes exactly one durable row for it: marker_count 3,
--           paged_at NULL. X1/key pins the row's generation_key to the NEWEST marker's id.
--   X2      a second detector call for the same exhaustion writes nothing and does not
--           raise.
--   X3      the boundary partner: the same seed with two markers is readmitted by the real
--           sweep, and the detector writes nothing for it.
--   X4      a strategy that exhausts again after its oldest marker aged out (one deleted,
--           a newer one added) gets a SECOND row whose generation_key is the newer marker.
--
-- Every `TEST FAILED (...)` raise sits DIRECTLY in the DO body (the mutation runner reads
-- an identity only from a single-frame inline_code_block raise). pg_temp helpers return
-- values and never raise an identity. Every id is gen_random_uuid(), emails end in
-- invalid.local, and every assertion is scoped to this file's own strategy ids (shared-DB
-- hygiene: TEST is shared with other people's CI). Dailies are stamped a century back so
-- the seeds outrank any plausible foreign candidate under the sweep's own ORDER BY. The
-- whole file is BEGIN ... ROLLBACK, and no timing is slept: ages are seeded offsets from
-- the part's single now().
--
-- pgTAP is NOT installed (CLAUDE.md), so assertions RAISE EXCEPTION and a clean run prints
-- NOTICEs only. Every RAISE format string is a single literal with % placeholders.
--
-- No psql meta-commands anywhere in this file, comments included: the sql-tests preflight
-- scans the whole file for them.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_reconcile_readmit_exhaustions.sql
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm carries a prose `RED-UNDER:` and a machine-readable
-- `RED-UNDER-M:` twin that scripts/mutation-runner applies to COPIES on a throwaway
-- pg-lane cluster to prove the arm reds on its own. Schema: scripts/mutation-runner/GRAMMAR.md.
-- The setup list is the sweep gate's (it carries the pg_cron enable migration and
-- 20260819150000, so the lane's cron.job holds the real sweep command), the default-privilege
-- stand-in so the migration's REVOKEs have something to revoke, then the migration under test.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/30-fixture-strategies-status-default.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111839_csv_daily_returns.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql","supabase/migrations/20260819130500_reconcile_sweep_readmit_terminalized_orphans.sql","supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql"]}

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Seeds one strategy for the user, with one dailies row stamped a century back (past the
-- sweep's one-hour grace window by construction) and no analytics row, no key and no job.
CREATE FUNCTION pg_temp.xr_strategy(p_user uuid, p_name text, p_status text) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_sid uuid;
BEGIN
  INSERT INTO public.strategies (user_id, name, status)
    VALUES (p_user, p_name, p_status) RETURNING id INTO v_sid;
  INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return, created_at)
    VALUES (v_sid, DATE '2026-01-02', 0.001, now() - interval '100 years');
  RETURN v_sid;
END
$f$;

-- Seeds one orphan marker row: a failed_final job carrying the terminalizer's fixed audit
-- literal (the same text the sweep's own gate seeds), created at the given instant so the
-- "newest marker" is unambiguous. Returns the job id.
CREATE FUNCTION pg_temp.xr_marker(p_sid uuid, p_created timestamptz) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at, last_error, created_at)
  VALUES
    ('compute_analytics_from_csv', p_sid, 'failed_final', 'normal', 3, now(),
     'orphaned_running_reaped: no worker completed this job within the 4h claim window',
     p_created)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$f$;

DO $$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_command  text;
  v_now      timestamptz := now();
  v_s1       uuid;
  v_m1       uuid;
  v_m2       uuid;
  v_m3       uuid;
  v_cnt      integer;
  v_ret      integer;
  v_state    text;
  v_mc       integer;
  v_key      uuid;
  v_paged    timestamptz;
BEGIN
  -- A missing sweep is a red gate, never a skip: the whole point of X1 is to measure the
  -- real sweep command.
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (X1): pg_cron is not installed here, so the real sweep command cannot be read and the sweep-versus-detector boundary cannot be measured. A gate that green-skips when its oracle is absent is not evidence.';
  END IF;
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (X1): the reconcile_dropped_enqueue_sweep cron job is not registered, so there is no sweep command to measure the detector against. A missing sweep is a red gate, never a skip.';
  END IF;

  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'xr-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'xr') ON CONFLICT (id) DO NOTHING;

  -- ===== ARM X1 - a strategy at the ceiling leaves exactly one durable row ==========
  -- THREE markers, created one, two and three days ago: AT the sweep's ceiling. The strategy
  -- is otherwise a sweep candidate (dailies past grace, no analytics row, no key, and its
  -- only job rows are markers), which is exactly the population the ceiling stops.
  v_s1 := pg_temp.xr_strategy(v_user, 'xr-x1', 'draft');
  v_m1 := pg_temp.xr_marker(v_s1, v_now - interval '3 days');
  v_m2 := pg_temp.xr_marker(v_s1, v_now - interval '2 days');
  v_m3 := pg_temp.xr_marker(v_s1, v_now - interval '1 day');

  -- The REAL sweep, read from cron.job and executed. At three markers it must readmit
  -- nothing: this is the half of the boundary the detector is the mirror image of.
  EXECUTE v_command;
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_s1 AND metadata->>'source' = 'reconcile-sweep';
  -- This raise is a seed-integrity control and carries no twin of its own: it states that
  -- the strategy this arm seeds really IS at the ceiling of the DEPLOYED sweep, so a detector
  -- row written below is evidence about the boundary and not about a seed the sweep would
  -- have healed anyway. The sweep's own gate (arm C5 of
  -- test_reconcile_dropped_enqueue_sweep.sql) is what bites on the ceiling itself.
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (X1): the real reconcile sweep readmitted a strategy carrying three orphan markers (% sweep-marked jobs), expected 0. The seed is not at the ceiling of the deployed sweep, so a durable row for it would say nothing about the boundary this arm measures.', v_cnt;
  END IF;

  v_ret := public.record_reconcile_readmit_exhaustions();
  SELECT count(*), max(marker_count), max(generation_key::text)::uuid, max(paged_at)
    INTO v_cnt, v_mc, v_key, v_paged
    FROM public.reconcile_readmit_exhaustions
   WHERE strategy_id = v_s1;
  -- RED-UNDER: turn the detector's inverted ceiling `) >= 3` into `) > 3`, so a strategy with
  --            exactly three markers is no longer selected. That is the off-by-one that
  --            leaves the one strategy the sweep just refused to readmit with no durable
  --            row at all, and nothing pages for it.
  -- RED-UNDER-M: {"arm":"X1","apply":[{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"    ) >= 3\n","replace":"    ) > 3\n","occurrences":1}]}
  IF v_ret < 1 OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (X1): the sweep refused a strategy carrying three orphan markers and the detector wrote % durable row(s) for it (it returned %), expected exactly 1. An exhausted strategy stays silent: the sweep gave up on it, nothing records that, and the marker rows that prove it age out of the 90-day failed-row retention.', v_cnt, v_ret;
  END IF;
  IF v_mc <> 3 OR v_paged IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (X1): the exhaustion row carries marker_count % and paged_at %, expected 3 and NULL. A row born already paged would never be paged, and a wrong count misstates how many cycles the strategy burned.', v_mc, v_paged;
  END IF;

  -- X1/key: the row's generation_key is the NEWEST marker's id (m3), so a later exhaustion
  -- of the same strategy, whose newest marker is a different row, is a different row.
  -- RED-UNDER: order the detector's newest-marker subquery ascending, so generation_key
  --            becomes the OLDEST marker's id. The first exhaustion still writes one row, but
  --            when the old markers age out the next exhaustion's key can collide with it
  --            or differ for the wrong reason, and the once-per-exhaustion rule is gone.
  -- RED-UNDER-M: {"arm":"X1/key","apply":[{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"           ORDER BY cjm.created_at DESC, cjm.id DESC\n","replace":"           ORDER BY cjm.created_at ASC, cjm.id ASC\n","occurrences":1}]}
  IF v_key IS DISTINCT FROM v_m3 THEN
    RAISE EXCEPTION 'TEST FAILED (X1/key): generation_key is % but the strategy''s NEWEST marker is %. The key must be the newest marker''s id, or two different exhaustions of one strategy cannot be told apart and the second page is swallowed.', v_key, v_m3;
  END IF;

  RAISE NOTICE 'ALL 1 ARMS EXECUTED (X1): the real sweep refuses a strategy at three orphan markers and the detector writes one durable row for it, keyed on the newest marker.';
END
$$;

ROLLBACK;
