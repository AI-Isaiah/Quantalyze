-- Migration: strategy_analytics.computed_at becomes NULLABLE; never-computed rows read NULL.
-- Phase 238 NEVERCOMPUTED, plan 05 (FACT-03). Founder ruling "FACT-03: how a never-computed
-- row is encoded" ("A: allow an empty date"), recorded in 238-CONTEXT.md.
-- =============================================================================
--
-- WHAT THIS DOES
-- --------------
-- STEP 1  ALTER COLUMN computed_at DROP DEFAULT, DROP NOT NULL (metadata only).
-- STEP 2  Backfill: computed_at := NULL on the rows that NEVER COMPLETED and carry NO figures.
-- STEP 3  Fail loud: a row guard (a never-completed, figure-less row that still carries a
--         date raises NEVERCOMPUTED and the whole apply rolls back) plus catalogue-only
--         checks on the column shape and on the hold trigger.
--
-- WHY (TODOS entry 166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT, and the founder ruling)
-- ---------------------------------------------------------------------------------
-- computed_at was NOT NULL DEFAULT now(). A first-ever strategy_analytics row that is
-- inserted as pending, computing or failed therefore carried its INSERT time as if it
-- were a compute time, and every reader of the column (the factsheet FreshnessChip, the
-- Sync panel, the portfolio PDF vintage, the staleness view) read "analytics last
-- computed <insert time>" off a row that never computed anything. The hold trigger of
-- 20261013120000 stops a FAILED or COMPUTING update from moving the date, which made the
-- insert-time lie permanent: nothing ever overwrites it until a success.
--
-- ⛔ THIS REVERSES Phase 166.5 CONTEXT R-04 ("first-ever rows keep the column
-- DEFAULT now() NOT NULL"). The reversal is a founder ruling, not drift: 166.5 chose to
-- leave the default because an INSERT has no prior stamp to restore and a nullable column
-- forced every reader to grow a NULL arm. Phase 238 pays that cost (plans 06 and 08) and
-- the default goes.
--
-- THE PREDICATE, and why it is not status alone
-- ---------------------------------------------
-- A row is "never computed" when ALL of:
--   * computation_status IN ('pending', 'computing', 'failed')   (never a success row:
--     a complete row's date is a real compute date even when its headline is NULL,
--     because an uncomputable metric is null by design);
--   * computed_at IS NOT NULL                                     (idempotent);
--   * cumulative_return IS NULL                                   (no headline);
--   * daily_returns and returns_series each NULL, '[]' or '{}'    (no stored series).
-- Status alone is wrong. PROD on 2026-11-26 (re-measured in 238-04): 11 failed rows with
-- no headline and no series, and 7 failed rows WITH a headline and a series. The 7 failed
-- recomputes sit on top of figures that were computed once, so their date is an honest
-- last-good date (founder, 2026-11-24). The predicate reads RAW figure presence, not the
-- cumulative_method marker: a legacy row computed before the marker existed keeps its date.
-- It is narrower than the app's hasStoredAnalyticsResult on purpose: when in doubt the date
-- stays. daily_returns may be an array, a {date: value} object or a nested object, so
-- emptiness is the jsonb literal 'null', '[]' or '{}' and any other shape counts as a series.
--
-- CALLER IMPACT, stated here so a reader of the migration sees it
-- ---------------------------------------------------------------
-- computed_at can now be NULL, so every reader needs a NULL arm. Plan 06 and plan 08 of this
-- phase move the TypeScript and Python readers in the SAME PR as this migration; it does not
-- ship without them. SQL readers (the staleness view, the recommendations RPC) carry the
-- date for information only. After this migration:
--   * a first-ever INSERT that supplies no date stores NULL;
--   * a write to failed or computing keeps a NULL date NULL (the hold trigger copies OLD,
--     which is NULL);
--   * a write to complete or complete_with_warnings stamps the date (the runner's success
--     write supplies it; the hold trigger does not touch a success status).
--
-- ⛔ FOR migration-reviewer, stated plainly: ALTER TABLE ... DISABLE TRIGGER
-- --------------------------------------------------------------------------
-- 1. It has NO precedent in supabase/migrations/. 20260719120000_retention_orphaned_running_compute_jobs.sql
--    says in a comment that it deliberately uses neither session_replication_role nor
--    DISABLE TRIGGER. It is needed here because strategy_analytics_hold_computed_at_until_success_trigger
--    restores OLD.computed_at on every UPDATE whose NEW status is failed or computing: a plain
--    UPDATE of the target rows (all pending, computing or failed) reports success and
--    changes nothing for exactly the rows it selects. The guard in STEP 3 exists because
--    that failure is silent (measured on a throwaway cluster: without the bypass the guard
--    raises and every date is kept).
-- 2. Lock: DISABLE TRIGGER takes SHARE ROW EXCLUSIVE on strategy_analytics until commit,
--    which blocks concurrent writers for the duration of one small UPDATE. It is bounded by
--    the 3 s lock_timeout below: a timeout aborts the apply loud and rolls back, to be retried.
-- 3. Atomicity: the trigger is disabled and re-enabled INSIDE the one implicit transaction
--    Supabase wraps around a migration, so an abort (the guard, a lock timeout) restores it.
--    STEP 3 asserts tgenabled = 'O' afterwards, from the catalogue.
-- 4. The other two BEFORE UPDATE triggers still fire on the backfill and are no-ops for these
--    rows. strategy_analytics_stamp_computing_started would stamp computing_started_at := now()
--    on a computing row whose stamp is NULL (its ARM (b)); 238-04 measured 0 computing rows
--    on PROD (no pending or computing row at all), so nothing is stamped.
--    strategy_analytics_drop_stale_error_provenance assigns only on a change of
--    computation_error, which this UPDATE does not make. There are exactly three BEFORE UPDATE
--    triggers on the table (supabase/schema/baseline.sql) and no replayed migration alters them.
-- 5. Privilege: disabling a named user trigger needs table ownership. The owner on PROD is
--    postgres (238-04). Whether the managed migration role is the owner is proven only by the
--    TEST apply-test log of the merge; a refusal rolls back on TEST and blocks PROD (safe,
--    a retry).
--
-- NO DATA CENSUS. STEP 3's row guard is the shape the data-dependence linter accepts
-- (PERFORM 1 ... ; IF FOUND THEN RAISE): it is FALSE on an empty table, so it cannot withhold
-- a PROD apply through shared TEST, which holds the catalogue and no rows. Every other check
-- reads the catalogue only.
--
-- WHAT THIS DELIBERATELY DOES NOT FIX
-- -----------------------------------
-- * It changes no function body, grant, policy or trigger definition. The hold trigger is
--   disabled and enabled, never re-issued.
-- * It does not null a date on any row that carries stored figures, nor on any success row.
-- * supabase/schema/baseline.sql, baseline-carried-migrations.txt and BASELINE.md are not
--   hand-edited here: the bot re-dump PR after the PROD apply owns them (Phase 164.9.5), and
--   until then the local-stack lanes replay this migration (Decision F).
--
-- ROLLBACK: supabase/migrations/down/20261126130000-rollback.sql, manual and off the
-- auto-apply path. It fills the NULLs with the epoch (never now()) and says why.
--
-- No explicit BEGIN/COMMIT: Supabase wraps each migration in one implicit transaction.

-- Fail loud rather than queue behind a long reader: ALTER TABLE takes ACCESS EXCLUSIVE and
-- DISABLE TRIGGER takes SHARE ROW EXCLUSIVE on strategy_analytics.
SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: nullable, no default (founder ruling A). Metadata only, no table rewrite.
-- --------------------------------------------------------------------------
ALTER TABLE public.strategy_analytics
  ALTER COLUMN computed_at DROP DEFAULT,
  ALTER COLUMN computed_at DROP NOT NULL;

-- --------------------------------------------------------------------------
-- STEP 2: backfill, with the hold trigger off for this one statement only.
-- --------------------------------------------------------------------------
ALTER TABLE public.strategy_analytics
  DISABLE TRIGGER strategy_analytics_hold_computed_at_until_success_trigger;

UPDATE public.strategy_analytics
   SET computed_at = NULL
 WHERE computation_status IN ('pending', 'computing', 'failed')
   AND computed_at IS NOT NULL
   AND cumulative_return IS NULL
   AND COALESCE(daily_returns,  'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)
   AND COALESCE(returns_series, 'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb);

ALTER TABLE public.strategy_analytics
  ENABLE TRIGGER strategy_analytics_hold_computed_at_until_success_trigger;

-- --------------------------------------------------------------------------
-- STEP 3: fail loud. One row guard, then catalogue-only checks.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_notnull   BOOLEAN;
  v_hasdef    BOOLEAN;
  v_tgtype    INT2;
  v_tgenabled "char";
BEGIN
  -- Row guard, in the one shape the data-dependence linter accepts. It fires only when a bad
  -- row SURVIVES, so it is false on an empty table (shared TEST holds none of PROD's rows).
  PERFORM 1 FROM public.strategy_analytics
   WHERE computation_status IN ('pending', 'computing', 'failed')
     AND computed_at IS NOT NULL
     AND cumulative_return IS NULL
     AND COALESCE(daily_returns,  'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)
     AND COALESCE(returns_series, 'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb);
  IF FOUND THEN
    RAISE EXCEPTION 'NEVERCOMPUTED: a never-completed row with no stored figures still carries a date (the hold trigger was not bypassed)';
  END IF;

  -- Column shape, from the catalogue.
  SELECT a.attnotnull, a.atthasdef INTO v_notnull, v_hasdef
    FROM pg_attribute a
   WHERE a.attrelid = 'public.strategy_analytics'::regclass
     AND a.attname = 'computed_at'
     AND NOT a.attisdropped;
  IF v_notnull IS NULL THEN
    RAISE EXCEPTION 'Migration 20261126130000 failed: strategy_analytics.computed_at not found';
  END IF;
  IF v_notnull THEN
    RAISE EXCEPTION 'Migration 20261126130000 failed: strategy_analytics.computed_at is still NOT NULL';
  END IF;
  IF v_hasdef THEN
    RAISE EXCEPTION 'Migration 20261126130000 failed: strategy_analytics.computed_at still has a default (a first-ever row would read as computed at its insert time)';
  END IF;

  -- The hold trigger must be back on: a trigger left disabled would let a failed or computing
  -- write move the date again.
  SELECT tgtype, tgenabled INTO v_tgtype, v_tgenabled
    FROM pg_trigger
   WHERE tgname = 'strategy_analytics_hold_computed_at_until_success_trigger'
     AND tgrelid = 'public.strategy_analytics'::regclass
     AND NOT tgisinternal;
  IF v_tgtype IS NULL THEN
    RAISE EXCEPTION 'Migration 20261126130000 failed: strategy_analytics_hold_computed_at_until_success_trigger is missing';
  END IF;
  IF v_tgenabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'Migration 20261126130000 failed: the hold trigger is not enabled (tgenabled=%)', v_tgenabled;
  END IF;
  -- pg_trigger.tgtype bits: 1 = FOR EACH ROW, 2 = BEFORE, 16 = update.
  IF (v_tgtype & 1) = 0 OR (v_tgtype & 2) = 0 OR (v_tgtype & 16) = 0 THEN
    RAISE EXCEPTION 'Migration 20261126130000 failed: the hold trigger is not BEFORE UPDATE FOR EACH ROW (tgtype=%)', v_tgtype;
  END IF;

  RAISE NOTICE 'Migration 20261126130000: strategy_analytics.computed_at is nullable with no default, never-computed rows are NULL, the hold trigger is enabled.';
END $$;
