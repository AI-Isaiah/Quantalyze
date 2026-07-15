-- PI-07: portfolio recompute in-flight UNIQUE fence
-- ==========================================================================
-- Replaces the non-unique partial lookup index
--   idx_portfolio_analytics_computing (portfolio_id, computed_at DESC)
--     WHERE computation_status = 'computing'   (mig 20260516170400)
-- with a partial UNIQUE index
--   portfolio_analytics_one_computing_per_portfolio (portfolio_id)
--     WHERE computation_status = 'computing'
-- so that at most ONE `computing` snapshot can exist per portfolio,
-- DB-enforced across processes.
--
-- WHY: the SELECT-then-INSERT in-flight guard in portfolio.py / cron.py is
-- TOCTOU across processes and the asyncio.Semaphore(3) is process-local, so
-- two workers can each read "no computing row" and both INSERT a `computing`
-- snapshot for the same portfolio. This is the exact fix named in the code
-- comment at analytics-service/routers/cron.py:869-871. Only the DB can fence
-- a cross-process race; the second racing INSERT now raises 23505.
--
-- D-P4 (replace, not coexist): no query orders by computed_at DESC within the
-- 'computing' partition — the reaper filters by age and both in-flight checks
-- are .eq(portfolio_id).eq(status).limit(1). The single-column partial UNIQUE
-- index serves the same lookups AND fences; two overlapping partial indexes
-- would be pure write overhead.
--
-- D-P5 (atomic single-tx plain build, NOT CONCURRENTLY): a CONCURRENTLY
-- unique build cannot share a transaction with the dedupe, leaving a window
-- where a fresh duplicate aborts the build and strands an INVALID index.
-- Instead this migration takes ACCESS EXCLUSIVE up front (explicit, so DROP
-- INDEX cannot escalate mid-tx into a lock-escalation deadlock), dedupes, and
-- builds — all atomically, ZERO dedupe->build race window. The HIGH-3 audit
-- precedent (mig 20260516170400) objected to an UNGUARDED blocking build;
-- here `lock_timeout = '5s'` aborts cleanly if the lock is contended, and
-- portfolio_analytics write volume is recompute-cadence (low), so the
-- post-acquisition dedupe+build is sub-second-to-seconds.
--
-- Dedupe (runs BEFORE the unique build — a unique index build over live
-- duplicates aborts, and this migration auto-applies to PROD on merge): keep
-- the greatest computed_at (tiebreak greatest id) per portfolio_id; flip all
-- other live `computing` rows to `failed` (a valid enum value, and exactly
-- what the reaper reset_stalled_portfolio_analytics itself uses).
-- ==========================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Explicit ACCESS EXCLUSIVE so the dedupe + DROP + unique build are atomic
-- with no window for a fresh duplicate, and so DROP INDEX does not escalate
-- the lock mid-transaction. lock_timeout bounds contention (D-P5).
LOCK TABLE public.portfolio_analytics IN ACCESS EXCLUSIVE MODE;

-- Dedupe pre-existing duplicate live `computing` rows BEFORE building the
-- unique index. Survivor = greatest computed_at (NULLS LAST), tiebreak
-- greatest id, per portfolio_id. Losers -> failed.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY portfolio_id
           ORDER BY computed_at DESC NULLS LAST, id DESC
         ) AS rn
    FROM public.portfolio_analytics
   WHERE computation_status = 'computing'
)
UPDATE public.portfolio_analytics pa
   SET computation_status = 'failed',
       computation_error  = 'PI-07 dedupe: superseded duplicate computing row (migration 20260714090000)'
  FROM ranked r
 WHERE pa.id = r.id AND r.rn > 1;

-- Drop the prior non-unique lookup index (D-P4: replaced, not coexisting).
DROP INDEX IF EXISTS public.idx_portfolio_analytics_computing;

-- The fence: at most one `computing` row per portfolio.
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_analytics_one_computing_per_portfolio
  ON public.portfolio_analytics (portfolio_id)
  WHERE computation_status = 'computing';

-- --------------------------------------------------------------------------
-- Self-verification (repo convention; model at 20260516170400:43-58).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_unique      boolean;
  v_old_present boolean;
  v_dupes       bigint;
BEGIN
  -- (a) new index exists AND is unique.
  SELECT i.indisunique INTO v_unique
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'portfolio_analytics_one_computing_per_portfolio';
  IF v_unique IS NULL THEN
    RAISE EXCEPTION 'PI-07 verification failed: portfolio_analytics_one_computing_per_portfolio missing after build';
  END IF;
  IF NOT v_unique THEN
    RAISE EXCEPTION 'PI-07 verification failed: portfolio_analytics_one_computing_per_portfolio exists but is NOT unique';
  END IF;

  -- (b) old non-unique index is gone.
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'portfolio_analytics'
       AND indexname  = 'idx_portfolio_analytics_computing'
  ) INTO v_old_present;
  IF v_old_present THEN
    RAISE EXCEPTION 'PI-07 verification failed: idx_portfolio_analytics_computing still present after replace';
  END IF;

  -- (c) no portfolio holds >1 live `computing` row (dedupe was effective).
  SELECT count(*) INTO v_dupes
    FROM (
      SELECT portfolio_id
        FROM public.portfolio_analytics
       WHERE computation_status = 'computing'
       GROUP BY portfolio_id
      HAVING count(*) > 1
    ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'PI-07 verification failed: % portfolio(s) still hold >1 computing row after dedupe', v_dupes;
  END IF;

  RAISE NOTICE 'PI-07 OK: partial UNIQUE fence built, old index dropped, zero remaining computing duplicates.';
END $$;

COMMIT;
