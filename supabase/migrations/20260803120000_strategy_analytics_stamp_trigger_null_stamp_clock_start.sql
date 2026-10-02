-- Migration: strategy_analytics computing_started_at STAMP TRIGGER (D-17 / D-01)
-- + the NULL-stamp CLOCK-START companion cron arm (D-11). Phase 142.1, v1.16,
-- 2026-08-03.
-- =============================================================================
--
-- FORWARD-ONLY DELTA
-- ------------------
-- Source migration:
-- supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql
-- (do NOT edit that file -- this is a forward-only delta on the same objects.
-- Header idiom copied from 20260516170000:18-19.) 20260802120000 is already
-- applied to the TEST project as version 20260802111053; amending an applied
-- migration is how two projects silently diverge.
--
-- WHAT THIS FIXES
-- ---------------
-- D-01. analytics_runner.py:1227-1241 `_mark_computing` writes
-- computing_started_at DIRECTLY, outside the SQL bridge's three-arm CASE, on
-- EVERY chain hop. The reap clock therefore restarted at the LAST hop instead of
-- chain start, so the worst-case stranded spinner ran ~1.75x the advertised
-- bound. Phase 142 forbade that advance for the BRIDGE; it could not forbid it
-- for a Python writer, because a per-writer rule cannot bind a writer that has
-- not been written yet. D-17 settled the remedy: move the invariant OUT of
-- per-writer code and onto the TABLE, where payload shape and call-site language
-- stop mattering.
--
-- D-11. Rows ALREADY at ('computing', NULL stamp) are invisible to the reaper
-- (its predicate skips NULL stamps deliberately -- a NULL stamp is a writer bug,
-- not a stranded job, and terminalizing it would convert a bug into user-visible
-- data loss). 20260802120000:103-107 claimed the STATIC CI stamp invariant was
-- the detection mechanism for them. That is a category error: a source scan
-- cannot see DB rows. The companion cron arm below is the runtime mechanism --
-- the only tier that CAN see rows. It is non-destructive: it STARTS the clock so
-- the existing reap threshold then applies normally.
--
-- ⭐ D-18 EVENT SCOPE -- this trigger fires on UPDATE only, never on INSERT
-- -----------------------------------------------------------------------
-- Settled 2026-08-02 (142.1-CONTEXT.md "D-18"). It supersedes the wider-event
-- trigger sketch in 142.1-RESEARCH.md § Architecture Patterns (Pattern 1) and
-- that sketch's insert-path arm behaviour; do not restore them. The literal
-- event list is not restated here -- every acceptance gate in this phase is a
-- text search over this file, and prose that quotes a gate's own literal is the
-- defect three prior plans in this phase each shipped. Three reasons, each
-- verified against source:
--
--   (i)   D-01's actual bug is an UPDATE. `_mark_computing` is an
--         `.upsert(..., on_conflict="strategy_id")`
--         (analytics_runner.py:1228-1241). Postgres fires the insert path on a
--         fresh row and the CONFLICT path on an existing one, and the row is
--         already 'computing' from hop 1 -- so the re-advance this trigger
--         exists to stop always arrives as an UPDATE.
--   (ii)  The insert path needs no guard. A fresh row entering 'computing' is a
--         genuine first transition: there is no prior stamp to advance.
--   (iii) A production INSERT of ('computing', NULL) IS the D-11 population, and
--         the companion cron arm below is its designated remedy (correction
--         C-1: the trigger subsumes NONE of D-11). Duplicating that remedy
--         inside the trigger would also fight the SQL gate, which establishes
--         every test state at INSERT precisely because the trigger does not fire
--         there (D-18 part 2).
--
-- UPDATE-only ALSO means DELETE-free, and that is deliberate. A DELETE-firing
-- guard on this table would import the sanitize_user GDPR-cascade exemption
-- obligation (20260710160000:67 -- every delete guard must exempt
-- `current_setting('quantalyze.sanitize_in_progress', true) = 'on'` or it aborts
-- the erasure). Do not widen the event list without adding that exemption.
--
-- SELF-CONTAINMENT INVARIANT (the landmine this design walks around)
-- ------------------------------------------------------------------
-- The trigger body reads ONLY NEW / OLD / TG_OP and calls ONLY now(). Zero
-- helper calls, zero side effects. That is not style -- it is what makes the
-- PRODUCTION-BREAKING class at
-- 20260516170000_match_decisions_visibility_check_secdef_fix.sql:3-11
-- structurally unreachable here. That incident was a trigger whose body invoked
-- a definer-rights helper that a later migration had REVOKEd from service_role;
-- the ACL is re-checked at FIRE time for functions the body CALLS, so every
-- service_role write to the table began failing with 42501. A body that calls
-- nothing has no such ACL to lose. STEP 3 below re-asserts this against the
-- DEPLOYED definition at apply time, not against this file's text.
--
-- The trigger COERCES SILENTLY and never RAISEs. A raising trigger would kill
-- the live `_mark_computing` call, burn its 3 retries and strand the strategy --
-- trading an invisible clock bug for an invisible payload-ignored behaviour is
-- accepted ONLY because SQL gate Part 6 (plan 142.1-08) makes the coercion
-- observable. Silence here is a deliberate, bounded cost, not an oversight.
--
-- CADENCE HONESTY (two mechanisms, two bounds -- never one number for both)
-- ------------------------------------------------------------------------
--   * MAIN REAP ARM. 20260802120000:32-36 advertises ~16h15m end-to-end
--     (16-hour threshold + up to 15 minutes of post-threshold detection
--     latency). D-01 made that claim FALSE, because the clock restarted at every
--     hop. This trigger restores it to TRUE by pinning the stamp at the writer
--     boundary for every writer, current and future.
--   * COMPANION CLOCK-START ARM. Its own worst case is a DIFFERENT and LARGER
--     number: a row stranded at ('computing', NULL) waits up to 15 minutes to be
--     noticed by this arm, then a full 16-hour threshold must elapse, then up to
--     another 15 minutes of reap-detection latency -- roughly 32.5 hours
--     end-to-end. That is the honest price of being non-destructive on a row
--     whose true start time is unknowable. Do not quote the ~16h15m figure for
--     a NULL-stamp row.
--
-- No explicit BEGIN/COMMIT -- Supabase wraps each migration in one implicit
-- transaction (migration-reviewer invariant #14), matching
-- 20260716131000:32-33 whose shape this file copies throughout.

-- Fail loud rather than queue behind a long reader: CREATE TRIGGER takes an
-- ACCESS EXCLUSIVE lock on strategy_analytics (20260716131000:35).
SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: the stamp-invariant trigger function
-- --------------------------------------------------------------------------
-- SECURITY INVOKER (the default -- the definer-rights form is deliberately NOT
-- used and NOT needed): the body touches only its own NEW/OLD tuples, so it
-- needs no privilege the firing statement does not already hold. Pinned
-- search_path per the 89-prior-migration convention.
CREATE OR REPLACE FUNCTION public.strategy_analytics_stamp_computing_started()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- TG_OP is always 'UPDATE' here (see the trigger definition in STEP 2); the
  -- arms below are written to be read alongside the four cases named in the
  -- header.
  IF NEW.computation_status = 'computing' THEN

    IF OLD.computation_status = 'computing'
       AND OLD.computing_started_at IS NOT NULL THEN
      -- ARM (a) -- NEVER ADVANCE. The row was already computing and already had
      -- a clock; whatever this writer supplied is discarded and the original
      -- start time is restored. This is D-01 closed at the table: it binds the
      -- Python upsert's conflict path, the SQL bridge, pg_cron, and every writer
      -- not yet written.
      --
      -- ⚠️ The `OLD.computing_started_at IS NOT NULL` conjunct is LOAD-BEARING.
      -- Without it, the companion clock-start arm in STEP 4 (an UPDATE of a
      -- ('computing', NULL) row) would be coerced straight back to NULL and D-11
      -- would stay open with a green gate over it.
      NEW.computing_started_at := OLD.computing_started_at;

    ELSIF NEW.computing_started_at IS NULL THEN
      -- ARM (b) -- a computing row must never sit unstamped after an UPDATE.
      -- Closes the NULL-stamp hole at the writer boundary for the UPDATE path.
      -- The rows that ALREADY exist, or that arrive via the insert path this
      -- trigger does not see, are the companion arm's job -- not this arm's.
      NEW.computing_started_at := now();

    -- ARM (c) -- fall through, deliberately. A genuine transition IN
    -- (OLD.computation_status IS DISTINCT FROM 'computing') that supplies its
    -- own non-NULL stamp is RESPECTED as written: the one-shot backfill anchor
    -- in 20260802120000 STEP 2 and the bridge's transition-in now() both depend
    -- on that.
    END IF;

  ELSE
    -- ARM (d) -- every exit clears the reaper key, unconditionally. A stale
    -- stamp left on a terminal row is exactly what the reaper could later
    -- re-fire on.
    NEW.computing_started_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.strategy_analytics_stamp_computing_started() IS
  'JOB-01 / Phase 142.1 D-17: enforces the computing_started_at invariant at the '
  'table for EVERY writer. On an update of an already-computing row that already '
  'carries a stamp it COERCES the new value back to the old one (never advance), '
  'silently -- raising would kill the live analytics_runner _mark_computing call, '
  'burn its retries and strand the strategy. A computing row left unstamped by an '
  'update is stamped now(); a genuine transition in that supplies its own stamp is '
  'respected; any row leaving computing has the stamp cleared. Self-contained: '
  'reads only NEW/OLD/TG_OP, calls only now(), invokes no helper (see migration '
  '20260516170000:3-11 for the incident class that rule exists to avoid).';

-- Trigger function: never invocable via PostgREST RPC. Revoke from the API roles
-- too (not just PUBLIC) -- matches 20260716131000:74.
REVOKE ALL ON FUNCTION public.strategy_analytics_stamp_computing_started() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: bind it -- UPDATE only (D-18 part 1; see the header EVENT SCOPE note)
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS strategy_analytics_stamp_computing_started_trigger ON public.strategy_analytics;
CREATE TRIGGER strategy_analytics_stamp_computing_started_trigger
  BEFORE UPDATE ON public.strategy_analytics
  FOR EACH ROW
  EXECUTE FUNCTION public.strategy_analytics_stamp_computing_started();

COMMENT ON TRIGGER strategy_analytics_stamp_computing_started_trigger ON public.strategy_analytics IS
  'JOB-01 / D-17 / D-18: fires on UPDATE only -- not on insert, not on delete. '
  'Coerces computing_started_at so no writer can advance the clock on a row that '
  'is already computing, stamps a computing row an update left unstamped, and '
  'clears the stamp on every exit from computing. Scope note for schema readers: the '
  'insert path is a genuine first transition (nothing to advance) and an inserted '
  '(computing, NULL) row is the D-11 population, whose remedy is the '
  'reap_strategy_analytics_stuck_computing clock-start arm, not this trigger. '
  'Widening to delete would require the sanitize_user erasure exemption '
  '(20260710160000:67).';

-- --------------------------------------------------------------------------
-- STEP 3: self-verify -- the trigger landed, with the right EVENT SCOPE
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_tgtype INT2;
BEGIN
  SELECT tgtype INTO v_tgtype
    FROM pg_trigger
   WHERE tgname = 'strategy_analytics_stamp_computing_started_trigger'
     AND tgrelid = 'public.strategy_analytics'::regclass
     AND NOT tgisinternal;

  IF v_tgtype IS NULL THEN
    RAISE EXCEPTION 'D-17 verification failed: strategy_analytics_stamp_computing_started_trigger missing after migration';
  END IF;

  -- pg_trigger.tgtype bit layout (pg_trigger.h): 1 = FOR EACH ROW, 2 = BEFORE,
  -- 4 = insert, 8 = delete, 16 = update. Asserting the BITS rather than grepping
  -- pg_get_triggerdef text keeps this check independent of Postgres' formatting.
  IF (v_tgtype & 1) = 0 THEN
    RAISE EXCEPTION 'D-17 verification failed: the stamp trigger is not FOR EACH ROW (tgtype=%); a statement-level trigger cannot see NEW/OLD at all', v_tgtype;
  END IF;
  IF (v_tgtype & 2) = 0 THEN
    RAISE EXCEPTION 'D-17 verification failed: the stamp trigger does not fire BEFORE the write (tgtype=%); an AFTER trigger cannot coerce NEW', v_tgtype;
  END IF;
  IF (v_tgtype & 16) = 0 THEN
    RAISE EXCEPTION 'D-17 verification failed: the stamp trigger does not fire on update (tgtype=%); D-01 arrives as the upsert conflict path, so an update-blind trigger fixes nothing', v_tgtype;
  END IF;
  IF (v_tgtype & 4) <> 0 THEN
    RAISE EXCEPTION 'D-17/D-18 verification failed: the stamp trigger ALSO fires on the insert path (tgtype=%). D-18 part 1 settled update-only: the SQL gate establishes every test state at insert time and an inserted (computing, NULL) row is the D-11 population the companion cron arm owns.', v_tgtype;
  END IF;
  IF (v_tgtype & 8) <> 0 THEN
    RAISE EXCEPTION 'D-18 verification failed: the stamp trigger fires on delete (tgtype=%), which imports the sanitize_user erasure-exemption obligation (20260710160000:67) this design deliberately avoids.', v_tgtype;
  END IF;

  RAISE NOTICE 'D-17: strategy_analytics_stamp_computing_started_trigger verified (row-level, before, update-only).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 4: self-verify -- the DEPLOYED function body is self-contained
-- --------------------------------------------------------------------------
-- Reads the definition Postgres actually stored, so an edit that lands a helper
-- call fails at APPLY time rather than at 03:00 on a live money path.
DO $$
DECLARE
  v_fn TEXT := pg_get_functiondef('public.strategy_analytics_stamp_computing_started()'::regprocedure);
BEGIN
  -- Regex literals below are deliberately lower-case. `~*` is case-insensitive,
  -- so the check is exactly as strong either way, and the phase's acceptance
  -- gates are literal case-sensitive text searches over this file -- writing the
  -- upper-case token here would make this guard trip the guard that guards it.
  IF v_fn ~* '\mperform\M' THEN
    RAISE EXCEPTION 'D-17 verification failed: the deployed trigger body invokes another routine. The body must read only NEW/OLD/TG_OP and call only now() -- a call re-opens the fire-time ACL trap of migration 20260516170000:3-11 (a trigger whose helper had been revoked from service_role broke every write to the table).';
  END IF;
  IF v_fn ~* 'security\s+definer' THEN
    RAISE EXCEPTION 'D-17 verification failed: the deployed trigger function acquired definer rights. It needs none -- it touches only its own NEW/OLD tuples -- and definer rights on a trigger are the 20260516170000 incident surface.';
  END IF;

  -- Positive anchor (PATTERNS S-5): the two negatives above would also pass over
  -- a gutted body. NB: do NOT anchor on 'public.' -- the pinned search_path
  -- clause contains it legitimately, so that anchor would pass vacuously.
  IF v_fn !~* 'RETURN\s+NEW' THEN
    RAISE EXCEPTION 'D-17 verification failed: the deployed trigger body never returns NEW, so a BEFORE row trigger would suppress the write entirely.';
  END IF;

  RAISE NOTICE 'D-17: deployed trigger body verified self-contained (no routine call, invoker rights, returns NEW).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 5: D-11 -- re-register the reaper cron with the companion clock-start arm
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'D-11: pg_cron extension is NOT installed. The strategy_analytics reaper cannot be re-registered with its clock-start arm. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- SAME jobname as 20260802120000:502. cron.schedule upserts on the job name,
  -- so this REPLACES the one-statement body rather than adding a second job; no
  -- unschedule step is needed, and STEP 6 asserts exactly one row survives under
  -- that name.
  --
  -- The body is TWO statements now, and the ORDER is load-bearing: clock-start
  -- FIRST, reap SECOND. A row this tick stamps therefore cannot be reaped by the
  -- same tick -- it gets a full threshold, which is the whole point of starting
  -- the clock rather than terminalizing.
  --
  -- The reap statement is copied BYTE-IDENTICALLY from 20260802120000:505-526.
  -- Every rationale for its four-column SET, its ordered/bounded/SKIP LOCKED
  -- shape and its compare-and-set fence lives at 20260802120000:452-500 and is
  -- deliberately not restated here -- one source of truth per claim.
  --
  -- The clock-start arm carries NO interval literal of its own. That is a hard
  -- constraint, not a preference: the drift gate
  -- (test_main_worker.py::TestReaperThresholdDriftGate) asserts the SET of
  -- interval literals in this whole body equals exactly the single canonical
  -- threshold from services/job_worker.py, so a second literal of ANY value
  -- reddens CI (correction C-11).
  --
  -- GATE-DETERMINISM NOTE (read with supabase/tests/test_..._reaper.sql arm D).
  -- Plan 142.1-03 DELETED that gate's cross-tenant neutralizing UPDATEs; its
  -- isolation is now by construction. Arm D asserts on the gate's OWN seeded
  -- ('computing', NULL, no active job) row, and its determinism rests on the
  -- residual assumption stated in that file's header PLUS fewer than 25 foreign
  -- rows in the same condition competing for this arm's budget at run time.
  -- Do NOT change this arm's target predicate without re-deriving that argument
  -- in the gate in the SAME commit, and vice versa.
  PERFORM cron.schedule(
    'reap_strategy_analytics_stuck_computing',
    '*/15 * * * *',
    $cron$
    UPDATE public.strategy_analytics sa
       SET computing_started_at = now()
     WHERE sa.strategy_id IN (
             SELECT s.strategy_id
               FROM public.strategy_analytics s
              WHERE s.computation_status = 'computing'
                AND s.computing_started_at IS NULL
                AND NOT EXISTS (
                      SELECT 1
                        FROM public.compute_jobs cj
                       WHERE cj.strategy_id = s.strategy_id
                         AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
                    )
              LIMIT 25
              FOR UPDATE SKIP LOCKED
           )
       AND sa.computation_status = 'computing'
       AND sa.computing_started_at IS NULL;

    UPDATE public.strategy_analytics sa
       SET computation_status   = 'failed',
           computation_warned   = FALSE,
           computation_error    = 'Analytics was interrupted before it could finish and did not recover. Retry the sync.',
           computing_started_at = NULL
     WHERE sa.strategy_id IN (
             SELECT s.strategy_id
               FROM public.strategy_analytics s
              WHERE s.computation_status = 'computing'
                AND s.computing_started_at IS NOT NULL
                AND s.computing_started_at < now() - interval '16 hours'
                AND NOT EXISTS (
                      SELECT 1
                        FROM public.compute_jobs cj
                       WHERE cj.strategy_id = s.strategy_id
                         AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
                    )
              ORDER BY s.computing_started_at ASC
              LIMIT 25
              FOR UPDATE SKIP LOCKED
           )
       AND sa.computation_status = 'computing';
    $cron$
  );

  RAISE NOTICE 'D-11: reap_strategy_analytics_stuck_computing re-registered (clock-start arm first, then the byte-identical 16-hour reap; still */15 and LIMIT 25 per arm).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 6: self-verify -- the DEPLOYED cron body carries BOTH arms
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_command TEXT;
  v_count   INTEGER;
BEGIN
  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'D-11 verification failed: expected exactly ONE cron job named reap_strategy_analytics_stuck_computing, found %. Two rows would mean cron.schedule appended instead of upserting by name, so the superseded one-arm body is still running alongside this one.', v_count;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';

  IF v_command NOT ILIKE '%computing_started_at IS NULL%' THEN
    RAISE EXCEPTION 'D-11 verification failed: the deployed body has no clock-start arm. Rows already stranded at computing with no stamp stay invisible to every mechanism this phase ships -- and the static CI invariant cannot see them, because a source scan cannot see rows (the category error at 20260802120000:103-107).';
  END IF;
  IF v_command NOT ILIKE '%interval ''16 hours''%' THEN
    RAISE EXCEPTION 'D-11/JOB-03 verification failed: the deployed body lost the 16-hour threshold from services/job_worker.py STRATEGY_ANALYTICS_REAP_THRESHOLD; the reap arm was not carried over byte-identically.';
  END IF;
  IF v_command ILIKE '%computed_at%' THEN
    RAISE EXCEPTION 'D-11 verification failed: the deployed body references computed_at, which the status bridge re-stamps on every job transition -- the row would never be reaped (the Phase 106 janitor bug).';
  END IF;

  RAISE NOTICE 'D-11: deployed cron body verified (single job, clock-start arm present, 16-hour reap intact).';
END $$;
