
-- ============================================================================
-- Phase 190 FACTSHEETQUEUED, SC-5 (the AFTER-DEPLOY reading, plan 08).
-- ============================================================================
-- READ-ONLY: one SELECT returning one row, no parameter, no write. Run the
-- database-marker query FIRST and ALONE on the same connection target; run this
-- only after it named PRODUCTION.
--   supabase db query --linked -f <this file>
-- The CLI returns only the LAST statement, so this file is ONE statement.
--
-- PUBLIC REPO: it selects counts only. No strategy id, key id, email or any
-- other row identity is selected, and none may be added.
--
-- DEFINITIONS reused from 190-MEASUREMENT.sql (finalize job, prior compute
-- done, private, retention); the fin and classified CTE bodies are the same,
-- with one added bound on fin.
--   T_DEPLOY = the UTC time production first served the phase 190 merge commit.
--              The literal below is the later of the Vercel production success
--              status and the Railway analytics success status for that commit.
--   wizard contribution finalized after the deploy: a strategy with source
--              'wizard' and status 'private' created after T_DEPLOY.
--   wizard manager submission after the deploy: the same with status
--              'pending_review' or 'published'.
-- A reading with wizard_contributions_finalized_after_deploy = 0 is VOID, never
-- a pass: nothing finalized, so a zero in the SC-2 column proves nothing.
-- ============================================================================
WITH fin AS (
  SELECT j.id, j.strategy_id, j.kind, j.status, j.created_at
    FROM public.compute_jobs j
   WHERE j.metadata ->> 'source' = 'finalize-wizard'
     AND j.kind IN ('sync_trades', 'stitch_composite')
     AND j.created_at > '2026-11-03T21:59:49Z'::timestamptz
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
SELECT (SELECT count(*) FROM classified) AS finalize_jobs_after_deploy,
       (SELECT count(*) FROM classified c WHERE c.prior_compute_done) AS finalize_jobs_after_deploy_after_first_compute_done,
       (SELECT count(*) FROM public.strategies s
         WHERE s.source = 'wizard' AND s.status = 'private'
           AND s.created_at > '2026-11-03T21:59:49Z'::timestamptz) AS wizard_contributions_finalized_after_deploy,
       (SELECT count(*) FROM public.strategies s
         WHERE s.source = 'wizard' AND s.status IN ('pending_review', 'published')
           AND s.created_at > '2026-11-03T21:59:49Z'::timestamptz) AS wizard_manager_submissions_after_deploy;
