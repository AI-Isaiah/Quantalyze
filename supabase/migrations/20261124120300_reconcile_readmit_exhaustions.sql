-- ==========================================================================
-- Migration 20261124120300: a durable row for every strategy whose reconcile readmit
-- hit its attempt ceiling, and the SQL detector that writes it.
-- Phase 227 JOBLEDGER, plan 04 (ROADMAP SC-3, requirement HEAL-03).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The reconcile sweep readmits a strategy that lost its worker, and stops readmitting
-- it once the strategy carries three orphan markers (failed_final rows whose last_error
-- starts with the fixed audit text the terminalizer stamps). Migration 20260819150000
-- put that ceiling in the sweep, which is the right place to hold it. But when the
-- ceiling holds, the strategy simply drops out of the sweep. Nothing records that, and
-- the marker rows themselves are deleted by the 90-day failed-row retention. So a
-- strategy the system gave up on is silent, and it stays silent after its evidence
-- ages out.
--
-- FOUNDER RULING 2026-11-23 (CONTEXT, HEAL-03), quoted: "Both: a durable row that
-- outlives the job rows' retention, plus a page through the existing ops_alert
-- channel. The ceiling is enforced in the pg_cron SQL sweep, so the SQL writes the
-- durable row and a Python reader pages from it." Reversibility one-way, already
-- ruled. This migration is the durable-row half; plan 09 pages from these rows.
--
-- WHAT THIS SHIPS
-- ---------------
--   1. The table public.reconcile_readmit_exhaustions: one row per (strategy,
--      generation_key). generation_key is the id of the strategy's newest marker row at
--      detection, with no foreign key, so the row outlives every job row it came from.
--      It is deleted with its strategy (ON DELETE CASCADE).
--   2. The SECURITY DEFINER function public.record_reconcile_readmit_exhaustions(),
--      which evaluates the sweep's own candidate predicate with ONE comparison inverted
--      (the sweep keeps strategies below the ceiling, the detector keeps strategies at
--      or above it) and writes the rows. It returns the number of rows written.
--
-- DECISIONS
-- ---------
-- DEC-04-A A detector function, and the sweep is NOT edited. RESEARCH Pattern 4
--   recommended re-registering the sweep with one added statement. This repository
--   forbids that. Under the Phase 164.7 rule (restated as D-02 in
--   docs/runbooks/derivecron-go-live.md and as D-10 in
--   src/__tests__/outagealert-migration-schedules-nothing.test.ts) a migration never
--   schedules or re-registers a job, because migrations auto-apply to PROD with no human
--   gate. Registration is a marker-guarded runbook step. So this file registers
--   nothing, and the sweep's command stays byte-identical, which also leaves the
--   sweep's twins, its TypeScript pins and its pytest pointer untouched.
-- DEC-04-B Who calls it. Plan 09's Python reader calls the detector, then reads the
--   unpaged rows and pages. SQL decides the ceiling and writes the durable row, and
--   Python only pages. That adds no new cron job. If the reader does not run, nothing
--   pages and no new row is written. That is the same blind spot the page has, because
--   the worker is also what would run any readmit.
-- DEC-04-C Once per exhaustion. UNIQUE (strategy_id, generation_key) plus ON CONFLICT
--   DO NOTHING makes re-detection a no-op. A strategy that cycles again after its old
--   markers age out has a new newest marker, so it gets a new row and a new page.
-- DEC-04-D Bounded. The detector writes at most 100 rows per call, in the sweep's own
--   order (oldest dailies first).
-- DEC-04-E The parity pin reads the PROD-captured manifest. Future sweep changes arrive
--   through a runbook plus a manifest re-capture, not a migration, so the vitest
--   src/__tests__/readmit-exhaustion-predicate-parity.test.ts compares the detector's
--   candidate predicate with the manifest's, not with an earlier migration.
--
-- INT-1 REACH, stated plainly (RESEARCH). A real worker-started orphan usually leaves a
-- computing or failed analytics row, and that row drops the strategy out of the sweep
-- before the ceiling applies. So this signal guards a narrow population: the window
-- between the claim and the first analytics mark, with no analytics row. Widening the
-- sweep's analytics conjunct is out of scope here.
--
-- The detector's candidate predicate is transcribed from the sweep command captured from
-- PROD in scripts/prod-prober/cron-manifest.json, with the same aliases and the same
-- conjunct order, and no comment inside it, because the parity vitest compares it byte
-- for byte after whitespace collapse.
--
-- OWNER AND ROW SECURITY. public.compute_jobs carries FORCE ROW LEVEL SECURITY with a
-- deny-all policy, and FORCE is the one clause under which owning the table is not an
-- exemption. The detector reads that table as its definer, so the definer must be
-- exempt from row security (rolsuper or rolbypassrls). A non-exempt owner would read zero
-- markers and the detector would report nothing, forever. The verify block asserts it.
--
-- ACL. The table is reachable by service_role for SELECT, and for UPDATE of paged_at only
-- (the reader stamps it after a delivered page). marker_count and generation_key are
-- written only by the detector. The function grants EXECUTE to service_role, because
-- plan 09's worker calls it, and to nobody else.
--
-- THIS FILE REGISTERS NOTHING and leaves the sweep untouched. Forward migration only.
-- It runs nothing against the database it is applied to except DDL and a catalogue-only
-- verify.
--
-- Transaction style: no explicit BEGIN or COMMIT. The migration runner wraps the file in
-- its own transaction. Every RAISE format string is one literal. The verify block at the
-- foot is CATALOGUE-ONLY: it reads no table row and never calls the detector, because
-- shared TEST holds PROD's catalogue and empty tables, and a data-reading check that
-- refuses on an empty table would block the PROD apply.
--
-- Rollback: supabase/migrations/down/20261124120300-rollback.sql (manual, never
-- auto-applied). Roll back plan 09's reader first, or it logs the missing relation on
-- every pass.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: public.reconcile_readmit_exhaustions
-- ==========================================================================
-- Plain CREATE TABLE, not IF NOT EXISTS: the name is new, so a collision must fail loud.
CREATE TABLE public.reconcile_readmit_exhaustions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id    uuid        NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  generation_key uuid        NOT NULL,
  marker_count   integer     NOT NULL,
  detected_at    timestamptz NOT NULL DEFAULT now(),
  paged_at       timestamptz NULL,
  CONSTRAINT reconcile_readmit_exhaustions_marker_count_chk
    CHECK (marker_count >= 3),
  CONSTRAINT reconcile_readmit_exhaustions_strategy_generation_uq
    UNIQUE (strategy_id, generation_key)
);

COMMENT ON TABLE public.reconcile_readmit_exhaustions IS
  'Phase 227 plan 04 (HEAL-03, migration 20261124120300): one row per strategy whose reconcile readmit hit its attempt ceiling of three orphan markers. Written only by public.record_reconcile_readmit_exhaustions(); paged_at is stamped only by the Python reader after a delivered page. Outlives the 90-day failed-row retention because generation_key carries no foreign key to compute_jobs. Deleted with its strategy.';
COMMENT ON COLUMN public.reconcile_readmit_exhaustions.id IS
  'Row id, generated. Written only by public.record_reconcile_readmit_exhaustions().';
COMMENT ON COLUMN public.reconcile_readmit_exhaustions.strategy_id IS
  'The strategy the reconcile sweep stopped readmitting. ON DELETE CASCADE: the row dies with its strategy. Written only by public.record_reconcile_readmit_exhaustions().';
COMMENT ON COLUMN public.reconcile_readmit_exhaustions.generation_key IS
  'The id of the strategy''s newest orphan marker row when the exhaustion was detected. No foreign key, so the row survives the deletion of every marker it was derived from. With strategy_id it makes one row per exhaustion. Written only by public.record_reconcile_readmit_exhaustions().';
COMMENT ON COLUMN public.reconcile_readmit_exhaustions.marker_count IS
  'How many orphan markers the strategy carried at detection (at least 3). Written only by public.record_reconcile_readmit_exhaustions().';
COMMENT ON COLUMN public.reconcile_readmit_exhaustions.detected_at IS
  'When the detector first wrote the row. Written only by public.record_reconcile_readmit_exhaustions().';
COMMENT ON COLUMN public.reconcile_readmit_exhaustions.paged_at IS
  'NULL until the Python reader delivered the page for this row. Stamped only by plan 09''s reader after a delivered page; the one column service_role may UPDATE.';

-- ==========================================================================
-- STEP 2: row security and grants
-- ==========================================================================
-- RLS ENABLED, deliberately WITHOUT FORCE and with no policy. The only writer is the
-- SECURITY DEFINER detector running as the table owner; FORCE would subject that owner
-- to a policy and turn its INSERT into a refusal. No role that matters to this table
-- needs a policy: service_role bypasses row security, and anon and authenticated hold
-- no privilege at all.
ALTER TABLE public.reconcile_readmit_exhaustions ENABLE ROW LEVEL SECURITY;

-- Supabase default privileges grant new tables to anon, authenticated and service_role,
-- so everything is revoked first and the two positive grants are restated.
REVOKE ALL ON TABLE public.reconcile_readmit_exhaustions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.reconcile_readmit_exhaustions TO service_role;
GRANT UPDATE (paged_at) ON TABLE public.reconcile_readmit_exhaustions TO service_role;

-- ==========================================================================
-- STEP 3: public.record_reconcile_readmit_exhaustions()
-- ==========================================================================
-- Plain CREATE FUNCTION, not OR REPLACE: the name is new, so a collision must fail loud.
CREATE FUNCTION public.record_reconcile_readmit_exhaustions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $rre$
DECLARE
  v_written integer;
BEGIN
  INSERT INTO public.reconcile_readmit_exhaustions (strategy_id, generation_key, marker_count)
  SELECT s.id,
         (SELECT cjm.id
            FROM public.compute_jobs cjm
           WHERE cjm.strategy_id = s.id
             AND cjm.status = 'failed_final'
             AND cjm.last_error LIKE 'orphaned_running_reaped:%'
           ORDER BY cjm.created_at DESC, cjm.id DESC
           LIMIT 1),
         (SELECT count(*)
            FROM public.compute_jobs cjn
           WHERE cjn.strategy_id = s.id
             AND cjn.status = 'failed_final'
             AND cjn.last_error LIKE 'orphaned_running_reaped:%')
    -- SFH-01 (review round 1): the LIMIT below applies BEFORE ON CONFLICT, so exhaustions already
    -- on file (oldest dailies first) could fill every slot on every call and a newer exhaustion
    -- would never be written or paged. The already-recorded generations are therefore removed
    -- here, in the FROM list and outside the span the parity vitest compares with the sweep.
    FROM (SELECT st.*
            FROM public.strategies st
           WHERE NOT EXISTS (
                   SELECT 1
                     FROM public.reconcile_readmit_exhaustions rx
                    WHERE rx.strategy_id = st.id
                      AND rx.generation_key = (SELECT cjr.id
                                                 FROM public.compute_jobs cjr
                                                WHERE cjr.strategy_id = st.id
                                                  AND cjr.status = 'failed_final'
                                                  AND cjr.last_error LIKE 'orphaned_running_reaped:%'
                                                ORDER BY cjr.created_at DESC, cjr.id DESC
                                                LIMIT 1))) s
    WHERE s.status <> 'archived'
    AND EXISTS (
    SELECT 1
    FROM public.csv_daily_returns d
    WHERE d.strategy_id = s.id
    )
    AND NOT EXISTS (
    SELECT 1
    FROM public.compute_jobs cj
    WHERE cj.strategy_id = s.id
    AND NOT ((cj.status = 'failed_final'
    AND cj.last_error LIKE 'orphaned_running_reaped:%') IS TRUE)
    )
    AND (
    SELECT count(*)
    FROM public.compute_jobs cjc
    WHERE cjc.strategy_id = s.id
    AND cjc.status = 'failed_final'
    AND cjc.last_error LIKE 'orphaned_running_reaped:%'
    ) >= 3
    AND NOT EXISTS (
    SELECT 1
    FROM public.strategy_analytics sa
    WHERE sa.strategy_id = s.id
    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')
    )
    AND NOT EXISTS (
    SELECT 1
    FROM public.strategy_keys sk
    WHERE sk.strategy_id = s.id
    )
    AND (
    SELECT max(dg.created_at)
    FROM public.csv_daily_returns dg
    WHERE dg.strategy_id = s.id
    ) < now() - interval '1 hour'
    ORDER BY (
    SELECT max(dg.created_at)
    FROM public.csv_daily_returns dg
    WHERE dg.strategy_id = s.id
    ) ASC
    LIMIT 100
    ON CONFLICT (strategy_id, generation_key) DO NOTHING;

  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written;
END
$rre$;

COMMENT ON FUNCTION public.record_reconcile_readmit_exhaustions() IS
  'Phase 227 plan 04 (HEAL-03): writes one public.reconcile_readmit_exhaustions row for every strategy the reconcile sweep would otherwise readmit but cannot, because it already carries three orphan markers. The candidate predicate is the sweep''s own with the ceiling comparison inverted (pinned to the PROD-captured cron manifest by a vitest). Idempotent per exhaustion (UNIQUE on strategy and newest marker id, ON CONFLICT DO NOTHING); at most 100 rows per call, oldest dailies first, among strategies whose current exhaustion is not already on file (so recorded rows cannot starve a new one). Returns the number of rows written. Registers nothing; plan 09''s reader calls it. EXECUTE is held by service_role only.';

REVOKE ALL ON FUNCTION public.record_reconcile_readmit_exhaustions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_reconcile_readmit_exhaustions() TO service_role;

-- ==========================================================================
-- STEP 4: self-verifying DO block (catalogue only)
-- ==========================================================================
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip. Asserts SHAPE, never behaviour
-- and never data; behaviour is covered by supabase/tests/test_reconcile_readmit_exhaustions.sql.
DO $verify$
DECLARE
  -- Every variable is DECLAREd up front: plpgsql compiles a DO block whole.
  v_rel       regclass;
  v_fn        oid;
  v_overloads integer;
  v_n         integer;
  v_secdef    boolean;
  v_config    text[];
  v_srchpath  text;
  v_defowner  text;
  v_bypass    boolean;
  v_super     boolean;
  v_col       text;
  v_body      text;
BEGIN
  v_rel := to_regclass('public.reconcile_readmit_exhaustions');
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120300: public.reconcile_readmit_exhaustions is missing';
  END IF;

  -- ----- the table ------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_class c
                  WHERE c.oid = v_rel AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'Migration 20261124120300: reconcile_readmit_exhaustions must have row security enabled and not forced';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policy p WHERE p.polrelid = v_rel;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Migration 20261124120300: reconcile_readmit_exhaustions carries % row security policies, expected none', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = v_rel
                    AND c.conname = 'reconcile_readmit_exhaustions_strategy_generation_uq'
                    AND c.contype = 'u'
                    AND pg_get_constraintdef(c.oid) = 'UNIQUE (strategy_id, generation_key)') THEN
    RAISE EXCEPTION 'Migration 20261124120300: the UNIQUE (strategy_id, generation_key) constraint is missing, so a repeated detection would write a second row for one exhaustion';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = v_rel
                    AND c.conname = 'reconcile_readmit_exhaustions_marker_count_chk'
                    AND c.contype = 'c'
                    AND pg_get_constraintdef(c.oid) LIKE '%marker_count >= 3%') THEN
    RAISE EXCEPTION 'Migration 20261124120300: the marker_count >= 3 CHECK constraint is missing';
  END IF;

  -- No foreign key to compute_jobs: that is what lets a row outlive the 90-day retention
  -- of the marker rows it was derived from.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.conrelid = v_rel
     AND c.contype = 'f'
     AND c.confrelid = 'public.compute_jobs'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Migration 20261124120300: reconcile_readmit_exhaustions carries % foreign key(s) to compute_jobs, so a row would die with the retention of its markers', v_n;
  END IF;

  -- strategy_id cascades, so a row is deleted with its strategy.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = v_rel
                    AND c.contype = 'f'
                    AND c.confrelid = 'public.strategies'::regclass
                    AND c.confdeltype = 'c') THEN
    RAISE EXCEPTION 'Migration 20261124120300: strategy_id does not reference public.strategies with ON DELETE CASCADE';
  END IF;

  -- ----- the privilege matrix --------------------------------------------------
  IF has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Migration 20261124120300: anon holds a privilege on reconcile_readmit_exhaustions';
  END IF;
  IF has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Migration 20261124120300: authenticated holds a privilege on reconcile_readmit_exhaustions';
  END IF;
  IF NOT has_table_privilege('service_role', v_rel, 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261124120300: service_role lacks SELECT on reconcile_readmit_exhaustions';
  END IF;
  IF has_table_privilege('service_role', v_rel, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Migration 20261124120300: service_role holds a table-level write privilege on reconcile_readmit_exhaustions';
  END IF;
  FOR v_col IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF has_column_privilege('anon', v_rel, v_col, 'SELECT,INSERT,UPDATE,REFERENCES')
       OR has_column_privilege('authenticated', v_rel, v_col, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Migration 20261124120300: anon or authenticated holds a column privilege on reconcile_readmit_exhaustions';
    END IF;
    IF has_column_privilege('service_role', v_rel, v_col, 'INSERT,REFERENCES') THEN
      RAISE EXCEPTION 'Migration 20261124120300: service_role holds a column INSERT privilege on reconcile_readmit_exhaustions';
    END IF;
    IF has_column_privilege('service_role', v_rel, v_col, 'UPDATE') IS DISTINCT FROM (v_col = 'paged_at') THEN
      RAISE EXCEPTION 'Migration 20261124120300: service_role UPDATE on reconcile_readmit_exhaustions must be held on paged_at and on no other column';
    END IF;
  END LOOP;

  -- ----- the function ----------------------------------------------------------
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_reconcile_readmit_exhaustions';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'Migration 20261124120300: record_reconcile_readmit_exhaustions resolves to % functions in schema public, expected exactly 1', v_overloads;
  END IF;

  v_fn := to_regprocedure('public.record_reconcile_readmit_exhaustions()');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120300: public.record_reconcile_readmit_exhaustions() takes arguments or is missing';
  END IF;

  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config FROM pg_proc p WHERE p.oid = v_fn;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20261124120300: record_reconcile_readmit_exhaustions is not SECURITY DEFINER, so it would read compute_jobs as the caller and write a table the caller cannot';
  END IF;
  SELECT c INTO v_srchpath
    FROM unnest(COALESCE(v_config, ARRAY[]::text[])) AS c
   WHERE c LIKE 'search_path=%';
  IF v_srchpath IS NULL OR regexp_replace(v_srchpath, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
    RAISE EXCEPTION 'Migration 20261124120300: record_reconcile_readmit_exhaustions must pin search_path to public, pg_catalog (found %)', v_srchpath;
  END IF;

  -- The definer must be exempt from row security, because compute_jobs carries FORCE ROW
  -- LEVEL SECURITY. rolsuper OR rolbypassrls, never rolbypassrls alone (a superuser
  -- bypasses row security with that flag still false).
  SELECT r.rolname, r.rolbypassrls, r.rolsuper
    INTO v_defowner, v_bypass, v_super
    FROM pg_proc p
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.oid = v_fn;
  IF v_defowner IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120300: could not resolve the owner of public.record_reconcile_readmit_exhaustions';
  END IF;
  IF NOT (COALESCE(v_bypass, FALSE) OR COALESCE(v_super, FALSE)) THEN
    RAISE EXCEPTION 'Migration 20261124120300: public.record_reconcile_readmit_exhaustions is owned by role % (rolsuper=%, rolbypassrls=%), exempt from row security by neither route, so it would read zero markers from compute_jobs and report nothing forever', v_defowner, v_super, v_bypass;
  END IF;

  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261124120300: service_role lacks EXECUTE on record_reconcile_readmit_exhaustions, so the reader cannot call it';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261124120300: anon or authenticated holds EXECUTE on record_reconcile_readmit_exhaustions';
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261124120300: PUBLIC holds EXECUTE on record_reconcile_readmit_exhaustions';
  END IF;

  -- The EXECUTABLE text, comments stripped, so prose describing a rule cannot satisfy it.
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_fn), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body NOT LIKE '%) >= 3%' THEN
    RAISE EXCEPTION 'Migration 20261124120300: the detector body lost its inverted ceiling comparison (>= 3), so it no longer selects the strategies the sweep refuses';
  END IF;
  IF v_body NOT LIKE '%ON CONFLICT (strategy_id, generation_key) DO NOTHING%' THEN
    RAISE EXCEPTION 'Migration 20261124120300: the detector body lost its ON CONFLICT clause, so a repeated detection would raise instead of being a no-op';
  END IF;

  RAISE NOTICE 'Migration 20261124120300: reconcile_readmit_exhaustions and record_reconcile_readmit_exhaustions() verified from the catalogues';
END
$verify$;
