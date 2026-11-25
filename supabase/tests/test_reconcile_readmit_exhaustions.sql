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
--   X5      non-candidates get no row: three markers plus a COMPLETE analytics row, three
--           markers plus a PENDING job, and three markers on an ARCHIVED strategy.
--   X6      the row survives the deletion of every marker row it was derived from (no foreign
--           key to compute_jobs, which is what outlives the 90-day failed-row retention) and
--           is deleted with its strategy.
--   X7      the ACL: anon and authenticated cannot read the table or call the detector;
--           service_role can read, can call the detector, can UPDATE paged_at, and cannot
--           UPDATE marker_count.
--   X8      (SFH-01) recorded exhaustions cannot starve a new one: 100 older exhausted
--           strategies already on file do not fill the detector's LIMIT 100 window, so a
--           newer exhausted strategy is still written.
--
-- The migration carries a catalogue-only self-verify block that refuses a bad apply. Each
-- twin below that breaks something the block also checks LAYERS a second edit that neuters
-- that one clause of the block, because an apply the block aborts never reaches the gate
-- and so no arm could be the first failure (GRAMMAR.md, Shape 3).
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
  v_kind     text;
  v_s3       uuid;
  v_s5a      uuid;
  v_s5b      uuid;
  v_s5c      uuid;
  v_s7       uuid;
  v_m_new    uuid;
  v_row      uuid;
  v_i        integer;
  v_sx       uuid;
  v_s8       uuid;
  v_n8       integer;
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
  -- RED-UNDER-M: {"arm":"X1","apply":[{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"    ) >= 3\n","replace":"    ) > 3\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"  IF v_body NOT LIKE '%) >= 3%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%) >= 3%' THEN\n","occurrences":1}]}
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

  -- ===== ARM X2 - re-detecting the same exhaustion writes nothing =====================
  -- The detector is called again for the SAME exhaustion. The call is wrapped, because a
  -- body without its ON CONFLICT clause answers with a raw unique_violation, and a raw
  -- error carries no identity: the handler turns it into a state the raise below names.
  v_state := NULL;
  BEGIN
    PERFORM public.record_reconcile_readmit_exhaustions();
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  SELECT count(*) INTO v_cnt
    FROM public.reconcile_readmit_exhaustions WHERE strategy_id = v_s1;
  -- RED-UNDER: drop the detector's ON CONFLICT clause. A repeated detection then collides with
  --            the UNIQUE (strategy_id, generation_key) constraint and raises, so the reader
  --            that calls the detector on every pass fails every pass after the first
  --            exhaustion, and nothing after that can ever be detected or paged. (The twin also
  --            stands down the SFH-01 already-recorded exclusion, which would otherwise keep a
  --            repeat call from reaching the INSERT at all; ON CONFLICT is the backstop.)
  -- RED-UNDER-M: {"arm":"X2","apply":[{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"\n    ON CONFLICT (strategy_id, generation_key) DO NOTHING;","replace":";","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"  IF v_body NOT LIKE '%ON CONFLICT (strategy_id, generation_key) DO NOTHING%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%ON CONFLICT (strategy_id, generation_key) DO NOTHING%' THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"WHERE NOT EXISTS (\n                   SELECT 1\n                     FROM public.reconcile_readmit_exhaustions rx","replace":"WHERE TRUE OR EXISTS (\n                   SELECT 1\n                     FROM public.reconcile_readmit_exhaustions rx","occurrences":1}]}
  IF v_state IS NOT NULL OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (X2): calling the detector again for the same exhaustion raised SQLSTATE % and left % row(s) for the strategy, expected no error and exactly 1. Re-detection must be a no-op, or the reader that calls it on every pass fails on the first strategy it has already recorded and every later exhaustion goes undetected.', v_state, v_cnt;
  END IF;

  -- ===== ARM X3 - the boundary partner: two markers is below the ceiling ================
  -- Same shape as X1 with TWO markers, one below the ceiling. The detector is called FIRST,
  -- while the strategy is still a pure sweep candidate: once the sweep readmits it, it carries
  -- a pending job and is excluded from the detector for a reason that has nothing to do with
  -- the ceiling. The call is wrapped because a detector whose comparison is loosened to two
  -- hits the table's CHECK (marker_count >= 3) and raises a raw error with no identity.
  v_s3 := pg_temp.xr_strategy(v_user, 'xr-x3', 'draft');
  PERFORM pg_temp.xr_marker(v_s3, v_now - interval '2 days');
  PERFORM pg_temp.xr_marker(v_s3, v_now - interval '1 day');
  v_state := NULL;
  BEGIN
    PERFORM public.record_reconcile_readmit_exhaustions();
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  SELECT count(*) INTO v_cnt
    FROM public.reconcile_readmit_exhaustions WHERE strategy_id = v_s3;
  -- RED-UNDER: loosen the detector's inverted ceiling `) >= 3` to `) >= 2`. A strategy the sweep
  --            WILL still readmit is then recorded as exhausted (here the table's own CHECK
  --            refuses it, which the handler turns into a state), so the page fires for
  --            strategies the sweep would still heal.
  -- RED-UNDER-M: {"arm":"X3","apply":[{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"    ) >= 3\n","replace":"    ) >= 2\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"  IF v_body NOT LIKE '%) >= 3%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%) >= 3%' THEN\n","occurrences":1}]}
  IF v_state IS NOT NULL OR v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (X3): the detector raised SQLSTATE % and recorded % exhaustion row(s) for a strategy carrying only TWO orphan markers, expected no error and none. The sweep still readmits this strategy, so recording it as exhausted pages for something the sweep would heal.', v_state, v_cnt;
  END IF;
  -- The real sweep, executed: at two markers it DOES readmit (the seed-integrity half).
  EXECUTE v_command;
  SELECT count(*), min(kind) INTO v_cnt, v_kind
    FROM public.compute_jobs
   WHERE strategy_id = v_s3 AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 1 OR v_kind IS DISTINCT FROM 'compute_analytics_from_csv' THEN
    RAISE EXCEPTION 'TEST FAILED (X3): the real reconcile sweep did not readmit a strategy carrying two orphan markers (% sweep-marked jobs of kind %), expected exactly 1 compute_analytics_from_csv job. The seed is not one below the ceiling of the deployed sweep, so the detector and the sweep are not being compared at their shared boundary.', v_cnt, v_kind;
  END IF;

  -- ===== ARM X4 - a strategy that exhausts again gets a second row =====================
  -- Retention deletes the oldest marker (m1) and the strategy cycles once more (a newer
  -- marker): it carries three markers again and its newest marker is a different row. The
  -- first exhaustion's row (keyed on m3) must stay, and a SECOND row keyed on the new marker
  -- must appear, so the second exhaustion pages again.
  DELETE FROM public.compute_jobs WHERE id = v_m1;
  v_m_new := pg_temp.xr_marker(v_s1, v_now - interval '1 hour');
  v_state := NULL;
  BEGIN
    PERFORM public.record_reconcile_readmit_exhaustions();
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  SELECT count(*) INTO v_cnt
    FROM public.reconcile_readmit_exhaustions WHERE strategy_id = v_s1;
  SELECT count(*), max(marker_count) INTO v_ret, v_mc
    FROM public.reconcile_readmit_exhaustions
   WHERE strategy_id = v_s1 AND generation_key = v_m_new;
  -- RED-UNDER: order the detector's newest-marker subquery ascending. The key is then the oldest
  --            surviving marker, which is not the newer marker the strategy just added, so the
  --            second exhaustion is recorded under the wrong key. The twin neuters X1/key,
  --            which pins the same expression one arm earlier and would otherwise fire first.
  -- RED-UNDER-M: {"arm":"X4","apply":[{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"           ORDER BY cjm.created_at DESC, cjm.id DESC\n","replace":"           ORDER BY cjm.created_at ASC, cjm.id ASC\n","occurrences":1}],"neuter":[{"arm":"X1/key"}]}
  IF v_state IS NOT NULL OR v_cnt <> 2 OR v_ret <> 1 OR v_mc <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (X4): after the oldest marker aged out and a newer one arrived the detector raised SQLSTATE %, the strategy has % exhaustion row(s) (expected 2) and % of them keyed on the newer marker with marker_count % (expected 1 and 3). A strategy that exhausts a second time must page a second time, so the second exhaustion needs its own row.', v_state, v_cnt, v_ret, v_mc;
  END IF;

  -- ===== ARM X5 - non-candidates get no row ============================================
  -- Three markers each, but each strategy is something the sweep itself would not touch for
  -- a reason other than the ceiling: a COMPLETE analytics row, a PENDING job, an ARCHIVED
  -- status. The detector must share those exclusions, or it pages for strategies that are
  -- not stranded.
  v_s5a := pg_temp.xr_strategy(v_user, 'xr-x5a', 'draft');
  v_s5b := pg_temp.xr_strategy(v_user, 'xr-x5b', 'draft');
  v_s5c := pg_temp.xr_strategy(v_user, 'xr-x5c', 'archived');
  PERFORM pg_temp.xr_marker(s, v_now - interval '3 days') FROM unnest(ARRAY[v_s5a, v_s5b, v_s5c]) AS s;
  PERFORM pg_temp.xr_marker(s, v_now - interval '2 days') FROM unnest(ARRAY[v_s5a, v_s5b, v_s5c]) AS s;
  PERFORM pg_temp.xr_marker(s, v_now - interval '1 day') FROM unnest(ARRAY[v_s5a, v_s5b, v_s5c]) AS s;
  INSERT INTO public.strategy_analytics (strategy_id, computation_status)
    VALUES (v_s5a, 'complete');
  INSERT INTO public.compute_jobs (kind, strategy_id, status, priority, attempts, next_attempt_at)
    VALUES ('compute_analytics_from_csv', v_s5b, 'pending', 'normal', 0, now());
  v_state := NULL;
  BEGIN
    PERFORM public.record_reconcile_readmit_exhaustions();
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  SELECT count(*) INTO v_cnt
    FROM public.reconcile_readmit_exhaustions
   WHERE strategy_id = ANY (ARRAY[v_s5a, v_s5b, v_s5c]);
  -- RED-UNDER: drop the analytics NOT EXISTS conjunct from the detector. A strategy that already
  --            has a COMPLETE analytics row is then recorded as exhausted although the sweep
  --            has no business with it, so the page names a strategy whose figures are
  --            healthy.
  -- RED-UNDER-M: {"arm":"X5","apply":[{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"    AND NOT EXISTS (\n    SELECT 1\n    FROM public.strategy_analytics sa\n    WHERE sa.strategy_id = s.id\n    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')\n    )\n","replace":"","occurrences":1}]}
  IF v_state IS NOT NULL OR v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (X5): the detector raised SQLSTATE % and recorded % row(s) for three strategies that carry three orphan markers but are not sweep candidates (complete analytics, a pending job, archived), expected no error and none. The detector must share every exclusion of the sweep, or it pages for strategies that are not stranded.', v_state, v_cnt;
  END IF;

  -- ===== ARM X6 - the row outlives its markers and dies with its strategy ===============
  -- The strategy's job rows are deleted (what the 90-day failed-row retention does to the
  -- markers): both of its exhaustion rows must survive, because the whole point of the table
  -- is to outlive them. Then the strategy goes, and its rows go with it.
  DELETE FROM public.compute_jobs WHERE strategy_id = v_s1;
  SELECT count(*) INTO v_cnt
    FROM public.reconcile_readmit_exhaustions WHERE strategy_id = v_s1;
  -- RED-UNDER: give generation_key a foreign key to compute_jobs with ON DELETE CASCADE. The
  --            exhaustion rows then die with the marker rows they were derived from, which is
  --            exactly when the evidence is gone, so the durable record does not outlive the
  --            90-day retention and the reader finds nothing to page from.
  -- RED-UNDER-M: {"arm":"X6","apply":[{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"  generation_key uuid        NOT NULL,\n","replace":"  generation_key uuid        NOT NULL REFERENCES public.compute_jobs(id) ON DELETE CASCADE,\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"     AND c.confrelid = 'public.compute_jobs'::regclass;\n","replace":"     AND c.confrelid = 'public.compute_job_kinds'::regclass;\n","occurrences":1}]}
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (X6): after every compute_jobs row of the strategy was deleted % exhaustion row(s) remain, expected 2. The row must outlive the job rows it was derived from (the 90-day failed-row retention deletes them), or the durable record disappears exactly when the evidence does.', v_cnt;
  END IF;
  DELETE FROM public.strategies WHERE id = v_s1;
  SELECT count(*) INTO v_cnt
    FROM public.reconcile_readmit_exhaustions WHERE strategy_id = v_s1;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (X6): % exhaustion row(s) remain after the strategy was deleted, expected 0. A row for a strategy that no longer exists would page about nothing, and would block the strategy''s own deletion if the key did not cascade.', v_cnt;
  END IF;

  -- ===== ARM X7 - the ACL ===============================================================
  -- One more exhausted strategy so a row exists to be read and updated. Every role is
  -- exercised through the privilege itself (SET LOCAL ROLE), never by inspecting a grant.
  v_s7 := pg_temp.xr_strategy(v_user, 'xr-x7', 'draft');
  PERFORM pg_temp.xr_marker(v_s7, v_now - interval '3 days');
  PERFORM pg_temp.xr_marker(v_s7, v_now - interval '2 days');
  PERFORM pg_temp.xr_marker(v_s7, v_now - interval '1 day');
  PERFORM public.record_reconcile_readmit_exhaustions();
  SELECT id INTO v_row FROM public.reconcile_readmit_exhaustions WHERE strategy_id = v_s7;

  v_state := NULL;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.reconcile_readmit_exhaustions;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  -- RED-UNDER: GRANT SELECT on the table to anon, which the REVOKE above it had removed. Anyone
  --            holding the public anon key can then read which strategies the platform gave up
  --            on. The twin neuters the migration's two self-verify clauses that would abort
  --            the apply on that grant.
  -- RED-UNDER-M: {"arm":"X7","apply":[{"kind":"insert-after","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","anchor":"GRANT SELECT ON TABLE public.reconcile_readmit_exhaustions TO service_role;","text":"\nGRANT SELECT ON TABLE public.reconcile_readmit_exhaustions TO anon;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"  IF has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN\n","replace":"  IF FALSE AND has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"    IF has_column_privilege('anon', v_rel, v_col, 'SELECT,INSERT,UPDATE,REFERENCES')\n","replace":"    IF FALSE AND has_column_privilege('anon', v_rel, v_col, 'SELECT,INSERT,UPDATE,REFERENCES')\n","occurrences":1}]}
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (X7): anon SELECT on reconcile_readmit_exhaustions answered SQLSTATE %, expected 42501 (insufficient_privilege). The table names the strategies the platform gave up on and must be unreadable to the public anon key.', v_state;
  END IF;

  v_state := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.reconcile_readmit_exhaustions;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (X7): authenticated SELECT on reconcile_readmit_exhaustions answered SQLSTATE %, expected 42501 (insufficient_privilege). A signed-in user must not read which strategies the platform gave up on.', v_state;
  END IF;

  v_state := NULL;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.record_reconcile_readmit_exhaustions();
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (X7): anon EXECUTE on the detector answered SQLSTATE %, expected 42501. The detector is a SECURITY DEFINER writer and only service_role may call it.', v_state;
  END IF;

  v_state := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_reconcile_readmit_exhaustions();
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (X7): authenticated EXECUTE on the detector answered SQLSTATE %, expected 42501. The detector is a SECURITY DEFINER writer and only service_role may call it.', v_state;
  END IF;

  -- service_role: reads, calls the detector, stamps paged_at, and cannot touch marker_count.
  v_state := NULL; v_cnt := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.record_reconcile_readmit_exhaustions();
    SELECT count(*) INTO v_cnt FROM public.reconcile_readmit_exhaustions WHERE id = v_row;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (X7): service_role could not call the detector and read its row (SQLSTATE %, % row(s) read, expected 1). The reader runs as service_role and needs both.', v_state, v_cnt;
  END IF;

  v_state := NULL; v_cnt := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.reconcile_readmit_exhaustions SET paged_at = v_now WHERE id = v_row;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (X7): service_role could not stamp paged_at (SQLSTATE %, % row(s) updated, expected 1). Without that the reader cannot record a delivered page and would page the same exhaustion again on every pass.', v_state, v_cnt;
  END IF;

  v_state := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.reconcile_readmit_exhaustions SET marker_count = 99 WHERE id = v_row;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  SELECT marker_count INTO v_mc FROM public.reconcile_readmit_exhaustions WHERE id = v_row;
  IF v_state IS DISTINCT FROM '42501' OR v_mc <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (X7): service_role UPDATE of marker_count answered SQLSTATE % and the stored value is %, expected 42501 and 3. marker_count and generation_key are written only by the detector, so a reader cannot rewrite the evidence it pages from.', v_state, v_mc;
  END IF;

  -- ===== ARM X8 - recorded exhaustions cannot starve a new one (SFH-01) ===============
  -- The detector takes LIMIT 100 BEFORE ON CONFLICT. Seed 100 exhausted strategies whose
  -- dailies are OLDER (200 years back) than the new one's, let the detector record them
  -- all, then seed one more exhausted strategy: with the recorded generations not
  -- excluded, the 100 oldest are the candidates on every call and the new one is never
  -- written, so the page HEAL-03 exists to send never fires.
  FOR v_i IN 1..100 LOOP
    INSERT INTO public.strategies (user_id, name, status)
      VALUES (v_user, 'xr x8 old ' || v_i, 'private') RETURNING id INTO v_sx;
    INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return, created_at)
      VALUES (v_sx, DATE '2026-01-02', 0.001, now() - interval '200 years');
    PERFORM pg_temp.xr_marker(v_sx, v_now - interval '3 days');
    PERFORM pg_temp.xr_marker(v_sx, v_now - interval '2 days');
    PERFORM pg_temp.xr_marker(v_sx, v_now - interval '1 day');
  END LOOP;
  v_ret := public.record_reconcile_readmit_exhaustions();
  SELECT count(*) INTO v_n8
    FROM public.reconcile_readmit_exhaustions r
    JOIN public.strategies st ON st.id = r.strategy_id
   WHERE st.user_id = v_user AND st.name LIKE 'xr x8 old %';
  IF v_n8 <> 100 THEN
    RAISE EXCEPTION 'TEST FAILED (X8-SETUP): the detector recorded % of the 100 seeded exhausted strategies (expected 100), so the arm cannot fill the detector''s 100-row window.', v_n8;
  END IF;
  v_s8 := pg_temp.xr_strategy(v_user, 'xr x8 new', 'private');
  PERFORM pg_temp.xr_marker(v_s8, v_now - interval '3 days');
  PERFORM pg_temp.xr_marker(v_s8, v_now - interval '2 days');
  PERFORM pg_temp.xr_marker(v_s8, v_now - interval '1 day');
  v_ret := public.record_reconcile_readmit_exhaustions();
  SELECT count(*) INTO v_cnt FROM public.reconcile_readmit_exhaustions WHERE strategy_id = v_s8;
  -- RED-UNDER: stop excluding recorded generations (`WHERE NOT EXISTS (... reconcile_readmit_exhaustions rx` becomes `WHERE TRUE OR EXISTS (...`), so the 100 recorded oldest strategies fill the LIMIT and the new exhaustion is never written.
  -- RED-UNDER-M: {"arm":"X8","apply":[{"kind":"edit","file":"supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql","find":"WHERE NOT EXISTS (\n                   SELECT 1\n                     FROM public.reconcile_readmit_exhaustions rx","replace":"WHERE TRUE OR EXISTS (\n                   SELECT 1\n                     FROM public.reconcile_readmit_exhaustions rx","occurrences":1}]}
  IF v_cnt <> 1 OR v_ret <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (X8): with 100 older exhaustions already recorded, a new exhausted strategy got % row(s) and the detector wrote % (expected 1 and 1). Recorded rows are filling the LIMIT 100 window, so a new exhaustion is never written or paged.', v_cnt, v_ret;
  END IF;

  RAISE NOTICE 'ALL 8 ARMS EXECUTED (X1, X2, X3, X4, X5, X6, X7, X8): the real sweep refuses a strategy at three orphan markers and the detector writes one durable row for it keyed on the newest marker (X1), re-detection writes nothing (X2), a strategy at two markers is left to the sweep (X3), a strategy that exhausts again gets a second row (X4), non-candidates get no row (X5), a row outlives its markers and dies with its strategy (X6), only service_role may read the table, call the detector and stamp paged_at (X7), and 100 recorded older exhaustions cannot starve a new one out of the LIMIT 100 window (X8).';
END
$$;

ROLLBACK;
