
-- ============================================================================
-- Phase 166.5 COMPUTEDATSTAMP, plan 08: the counts-only reading of how far
-- strategy_analytics.computed_at has drifted from the analytics runner's own
-- finish. The BEFORE reading (plan 08), the AFTER-DEPLOY reading (plan 09) and
-- the post-Wave-5 re-measurement all run THIS file verbatim, so the three
-- tables are comparable (T-166.5-30).
-- ============================================================================
-- READ-ONLY: one SELECT, no parameter, no write. Run 166.5-MEASUREMENT-marker.sql
-- FIRST and ALONE on the same connection target; run this only after it printed
-- `marker OK`.
--   supabase db query --linked -f <this file>
-- The CLI returns only the LAST statement, so this file is ONE statement.
--
-- PUBLIC REPO: it selects counts and version strings only. No strategy id, key
-- id, email or any other row identity is selected, and none may be added.
--
-- DEFINITIONS
--   runner done   a `done` compute job of kind compute_analytics_from_csv or
--                 stitch_composite (the two kinds that write metrics). The
--                 job's updated_at is the database-clock time it became done.
--                 `last runner done` is the newest such job per strategy. Done
--                 jobs are kept 30 days, so older history is not retained.
--   side job      kind sync_funding, poll_positions, reconcile_strategy or
--                 compute_intro_snapshot (the four kinds the status bridge
--                 treats as side work, v_side_kinds).
--   within 60 s   an absolute difference of at most 60 seconds.
--   too new       computed_at more than 60 s AFTER the last runner done, i.e. a
--                 date nothing but a side job or a non-recompute transition
--                 could have written.
--   composite     a strategy with any strategy_keys row. untrusted member: one
--                 of its keys has sync_status revoked or sign_in_failed, or has
--                 disconnected_at set. keyless CSV: a non-composite strategy
--                 with no api_key_id. published: strategies.status = 'published'.
--
-- COLUMN GROUPS (in order)
--   status split; rows with no retained runner done; date within 60 s of / more
--   than 60 s after / older than the last runner done; date within 60 s of a
--   LATER side-job done (the failure mode); the same against a side-job
--   failed_final; the same against a side-job done when NO runner done is
--   retained; rows stamped in the last 24 h and, of those, rows with no runner
--   done in that window; composites, composites with an untrusted member,
--   non-composites, keyless CSV, published, published and stamped in 24 h; then
--   the newest three migration-ledger versions, the bridge's argument count(s),
--   the trigger count on strategy_analytics, and two yes/no readings of the
--   LIVE bridge body (whether it carries the Phase 166.5 trigger flag, and
--   whether its comment-stripped body still names computed_at).
-- ============================================================================
WITH job_last AS (
  SELECT j.strategy_id, max(j.updated_at) AS runner_t
    FROM public.compute_jobs j
   WHERE j.status = 'done'
     AND j.kind IN ('compute_analytics_from_csv', 'stitch_composite')
   GROUP BY j.strategy_id
), per_row AS (
  SELECT a.strategy_id,
         a.computed_at,
         a.computation_status,
         jl.runner_t,
         (s.status = 'published') AS is_published,
         (s.api_key_id IS NULL)   AS is_keyless,
         EXISTS (SELECT 1 FROM public.strategy_keys sk
                  WHERE sk.strategy_id = a.strategy_id) AS is_composite,
         EXISTS (SELECT 1 FROM public.strategy_keys sk
                   JOIN public.api_keys ak ON ak.id = sk.api_key_id
                  WHERE sk.strategy_id = a.strategy_id
                    AND (ak.sync_status IN ('revoked', 'sign_in_failed')
                         OR ak.disconnected_at IS NOT NULL)) AS has_untrusted,
         EXISTS (SELECT 1 FROM public.compute_jobs j
                  WHERE j.strategy_id = a.strategy_id
                    AND j.status = 'done'
                    AND j.kind IN ('sync_funding', 'poll_positions',
                                   'reconcile_strategy', 'compute_intro_snapshot')
                    AND jl.runner_t IS NOT NULL
                    AND j.updated_at > jl.runner_t
                    AND abs(extract(epoch FROM (a.computed_at - j.updated_at))) <= 60) AS eq_later_side_done,
         EXISTS (SELECT 1 FROM public.compute_jobs j
                  WHERE j.strategy_id = a.strategy_id
                    AND j.status = 'failed_final'
                    AND j.kind IN ('sync_funding', 'poll_positions',
                                   'reconcile_strategy', 'compute_intro_snapshot')
                    AND jl.runner_t IS NOT NULL
                    AND j.updated_at > jl.runner_t
                    AND abs(extract(epoch FROM (a.computed_at - j.updated_at))) <= 60) AS eq_later_side_failed,
         EXISTS (SELECT 1 FROM public.compute_jobs j
                  WHERE j.strategy_id = a.strategy_id
                    AND j.status = 'done'
                    AND j.kind IN ('sync_funding', 'poll_positions',
                                   'reconcile_strategy', 'compute_intro_snapshot')
                    AND jl.runner_t IS NULL
                    AND abs(extract(epoch FROM (a.computed_at - j.updated_at))) <= 60) AS eq_side_done_no_runner
    FROM public.strategy_analytics a
    LEFT JOIN public.strategies s ON s.id = a.strategy_id
    LEFT JOIN job_last jl ON jl.strategy_id = a.strategy_id
)
SELECT
  count(*)                                                                              AS rows_total,
  count(*) FILTER (WHERE computation_status IN ('complete', 'complete_with_warnings'))  AS status_complete,
  count(*) FILTER (WHERE computation_status = 'failed')                                 AS status_failed,
  count(*) FILTER (WHERE computation_status = 'computing')                              AS status_computing,
  count(*) FILTER (WHERE computation_status NOT IN ('complete', 'complete_with_warnings', 'failed', 'computing')) AS status_other,
  count(*) FILTER (WHERE runner_t IS NULL)                                              AS no_runner_done_retained,
  count(*) FILTER (WHERE runner_t IS NOT NULL
                     AND abs(extract(epoch FROM (computed_at - runner_t))) <= 60)       AS date_within_60s_of_runner_done,
  count(*) FILTER (WHERE runner_t IS NOT NULL
                     AND computed_at > runner_t + interval '60 seconds')                AS date_over_60s_after_runner_done,
  count(*) FILTER (WHERE runner_t IS NOT NULL
                     AND computed_at < runner_t - interval '60 seconds')                AS date_older_than_runner_done,
  count(*) FILTER (WHERE eq_later_side_done)                                            AS date_eq_later_side_done,
  count(*) FILTER (WHERE eq_later_side_failed)                                          AS date_eq_later_side_failed_final,
  count(*) FILTER (WHERE eq_side_done_no_runner)                                        AS date_eq_side_done_no_runner_retained,
  count(*) FILTER (WHERE computed_at > now() - interval '24 hours')                     AS stamped_24h,
  count(*) FILTER (WHERE computed_at > now() - interval '24 hours'
                     AND (runner_t IS NULL OR runner_t < now() - interval '24 hours'))  AS stamped_24h_no_runner_done_24h,
  count(*) FILTER (WHERE is_composite)                                                  AS composites,
  count(*) FILTER (WHERE is_composite AND has_untrusted)                                AS composites_untrusted_member,
  count(*) FILTER (WHERE NOT is_composite)                                              AS non_composites,
  count(*) FILTER (WHERE NOT is_composite AND is_keyless)                               AS keyless_csv,
  count(*) FILTER (WHERE is_published)                                                  AS published,
  count(*) FILTER (WHERE is_published AND computed_at > now() - interval '24 hours')    AS published_stamped_24h,
  (SELECT string_agg(v.version, ', ' ORDER BY v.version DESC)
     FROM (SELECT version FROM supabase_migrations.schema_migrations
            ORDER BY version DESC LIMIT 3) v)                                           AS ledger_newest_three,
  (SELECT string_agg(p.pronargs::text, ', ' ORDER BY p.pronargs)
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'sync_strategy_analytics_status')                                  AS bridge_arity,
  (SELECT count(*)::text FROM pg_trigger t
    WHERE t.tgrelid = to_regclass('public.strategy_analytics')
      AND NOT t.tgisinternal)                                                           AS triggers_on_strategy_analytics,
  (SELECT CASE WHEN regexp_replace(regexp_replace(
                      pg_get_functiondef(to_regprocedure('public.sync_strategy_analytics_status(uuid, uuid)')),
                      '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn') ~ '\mv_side_trigger\s*:='
               THEN 'yes' ELSE 'no' END)                                                AS bridge_body_has_side_trigger_flag,
  (SELECT CASE WHEN regexp_replace(regexp_replace(
                      pg_get_functiondef(to_regprocedure('public.sync_strategy_analytics_status(uuid, uuid)')),
                      '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn') ~* '\mcomputed_at\M'
               THEN 'yes' ELSE 'no' END)                                                AS bridge_body_names_computed_at
  FROM per_row;
