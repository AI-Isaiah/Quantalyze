
-- ============================================================================
-- Phase 166.5 COMPUTEDATSTAMP, plan 08: the since-a-time reading. After the
-- Railway worker runs the Phase 166.5 code, this file answers: for every runner
-- finish since a given instant, did the runner stamp the date itself, and did
-- anything else move it?
-- ============================================================================
-- READ-ONLY: one SELECT. Counts only; no row identity is selected.
--
-- The tracked text carries the literal placeholder  __SINCE_UTC__  as code exactly
-- once (the `since` CTE below) and names it in this header. It is substituted ONLY
-- in a scratch copy that is never committed:
--   sed "s/__SINCE_UTC__/2026-10-16 08:00:00+00/" <this file> > <scratch>/since.sql
--   supabase db query --linked -f <scratch>/since.sql
-- Run 166.5-MEASUREMENT-marker.sql first and alone, as for the other reading.
--
-- COLUMNS
--   runner_done_since                 `done` jobs of kind
--                                     compute_analytics_from_csv or stitch_composite
--                                     with updated_at after the instant.
--   dates_stamped_by_runner           of those jobs, the number whose strategy row's
--                                     computed_at lies within the 600 s BEFORE the
--                                     job's updated_at (the runner stamps at its
--                                     write; the bridge marks the job done moments
--                                     later). With the code live this should equal
--                                     runner_done_since for every job that is the
--                                     strategy's newest runner done.
--   dates_eq_later_side_finish        of those jobs, the number whose row date lies
--                                     within 60 s of a LATER side-job finish (done
--                                     or failed_final). Should be 0: a side finish
--                                     must not move the date.
--   failed_rows_date_moved_no_runner  `failed` rows whose computed_at is after the
--                                     instant with no runner `done` for that
--                                     strategy after it. Should be 0: a failure
--                                     must not move the date (D-04).
-- ============================================================================
WITH since AS (
  SELECT '__SINCE_UTC__'::timestamptz AS t
), runner_jobs AS (
  SELECT j.id, j.strategy_id, j.updated_at AS done_at
    FROM public.compute_jobs j, since
   WHERE j.status = 'done'
     AND j.kind IN ('compute_analytics_from_csv', 'stitch_composite')
     AND j.updated_at > since.t
), rj AS (
  SELECT r.id,
         a.computed_at,
         r.done_at,
         EXISTS (SELECT 1 FROM public.compute_jobs s
                  WHERE s.strategy_id = r.strategy_id
                    AND s.status IN ('done', 'failed_final')
                    AND s.kind IN ('sync_funding', 'poll_positions',
                                   'reconcile_strategy', 'compute_intro_snapshot')
                    AND s.updated_at > r.done_at
                    AND abs(extract(epoch FROM (a.computed_at - s.updated_at))) <= 60) AS eq_later_side
    FROM runner_jobs r
    JOIN public.strategy_analytics a ON a.strategy_id = r.strategy_id
)
SELECT
  (SELECT count(*) FROM runner_jobs)                                                   AS runner_done_since,
  (SELECT count(*) FROM rj
    WHERE rj.computed_at BETWEEN rj.done_at - interval '600 seconds' AND rj.done_at)    AS dates_stamped_by_runner,
  (SELECT count(*) FROM rj WHERE rj.eq_later_side)                                      AS dates_eq_later_side_finish,
  (SELECT count(*) FROM public.strategy_analytics a, since
    WHERE a.computation_status = 'failed'
      AND a.computed_at > since.t
      AND NOT EXISTS (SELECT 1 FROM runner_jobs r WHERE r.strategy_id = a.strategy_id)) AS failed_rows_date_moved_no_runner;
