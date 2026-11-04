
-- ============================================================================
-- Phase 190 FACTSHEETQUEUED, SC-1 (the BEFORE reading, plan 01) and the
-- after-deploy reading (plan 08) both run THIS body, so the two tables are
-- comparable. Plan 08 re-runs it with a deploy-time bound added to the `fin`
-- CTE (and to nothing else).
-- ============================================================================
-- READ-ONLY: one SELECT, no parameter, no write. Run the database-marker query
-- FIRST and ALONE on the same connection target; run this only after it named
-- PRODUCTION.
--   supabase db query --linked -f <this file>
-- The CLI returns only the LAST statement, so this file is ONE statement.
--
-- PUBLIC REPO: it selects counts, kinds and dates only. No strategy id, key id,
-- email or any other row identity is selected, and none may be added.
--
-- DEFINITIONS
--   finalize job       a compute_jobs row whose metadata source is
--                      finalize-wizard and whose kind is sync_trades or
--                      stitch_composite (the legacy finalize arm's enqueue).
--   prior compute done an earlier job D on the same strategy, of kind
--                      compute_analytics_from_csv, stitch_composite or
--                      compute_analytics, with status done, D.created_at before
--                      the finalize job's created_at and D.updated_at at or
--                      before it. updated_at on a done row is when it became
--                      done, because done is terminal.
--   private            strategies.status = 'private' (the contribution path).
--   retention          done jobs are deleted after 30 days by the retention
--                      cron and failed_* jobs after 90 days, so the count
--                      covers about the last 30 days, not all history.
-- ============================================================================
WITH fin AS (
  SELECT j.id, j.strategy_id, j.kind, j.status, j.created_at
    FROM public.compute_jobs j
   WHERE j.metadata ->> 'source' = 'finalize-wizard'
     AND j.kind IN ('sync_trades', 'stitch_composite')
),
classified AS (
  SELECT f.*,
         EXISTS (
           SELECT 1 FROM public.compute_jobs d
            WHERE d.strategy_id = f.strategy_id
              AND d.id <> f.id
              AND d.kind IN ('compute_analytics_from_csv', 'stitch_composite', 'compute_analytics')
              AND d.status = 'done'
              AND d.created_at < f.created_at
              AND d.updated_at <= f.created_at
         ) AS prior_compute_done
    FROM fin f
)
SELECT c.kind,
       count(*) AS finalize_jobs,
       count(DISTINCT c.strategy_id) AS strategies,
       count(*) FILTER (WHERE c.prior_compute_done) AS jobs_after_first_compute_done,
       count(DISTINCT c.strategy_id) FILTER (WHERE c.prior_compute_done) AS strategies_after_first_compute_done,
       count(DISTINCT c.strategy_id) FILTER (WHERE c.prior_compute_done AND s.status = 'private') AS private_strategies_after_first_compute_done,
       min(c.created_at)::date AS oldest_seen,
       max(c.created_at)::date AS newest_seen
  FROM classified c
  LEFT JOIN public.strategies s ON s.id = c.strategy_id
 GROUP BY c.kind;
