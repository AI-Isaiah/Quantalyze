
-- ============================================================================
-- Phase 190 FACTSHEETQUEUED, plan 01: how many PROD strategy_analytics rows
-- carry the three stored-result evidence checks the re-run rule (plan 03)
-- relies on. This measures the REACH of D-02: a row that fails a check would
-- stay withheld during a re-run.
-- ============================================================================
-- READ-ONLY: one SELECT, no parameter, no write. Run the database-marker query
-- FIRST and ALONE on the same connection target; run this only after it named
-- PRODUCTION.
--   supabase db query --linked -f <this file>
-- The CLI returns only the LAST statement, so this file is ONE statement.
--
-- PUBLIC REPO: counts only. No strategy id or any row identity is selected,
-- and none may be added.
--
-- DEFINITIONS
--   terminal success   computation_status complete or complete_with_warnings.
--   series check       daily_returns holds a value other than SQL null or the
--                      json values [], {} and null, OR returns_series is a json
--                      array with at least one element.
--   headline check     cumulative_return is present and finite (not NaN, not
--                      plus or minus infinity).
--   marker check       data_quality_flags carries a string-typed
--                      cumulative_method key (stamped only by the two
--                      terminal-success writers).
--   all three          series check AND headline check AND marker check.
--   published          strategies.status = 'published'.
-- ============================================================================
WITH t AS (
  SELECT a.computation_status AS st,
         s.status AS strategy_status,
         (
           (a.daily_returns IS NOT NULL
            AND a.daily_returns NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb))
           OR (CASE WHEN jsonb_typeof(a.returns_series) = 'array'
                    THEN jsonb_array_length(a.returns_series) > 0
                    ELSE false END)
         ) AS has_series,
         (a.cumulative_return IS NOT NULL
          AND a.cumulative_return NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) AS has_headline,
         (jsonb_typeof(a.data_quality_flags -> 'cumulative_method') = 'string') AS has_marker
    FROM public.strategy_analytics a
    LEFT JOIN public.strategies s ON s.id = a.strategy_id
)
SELECT count(*) AS rows_total,
       count(*) FILTER (WHERE st IN ('complete', 'complete_with_warnings')) AS rows_terminal_success,
       count(*) FILTER (WHERE st IN ('complete', 'complete_with_warnings') AND has_series) AS ts_with_series,
       count(*) FILTER (WHERE st IN ('complete', 'complete_with_warnings') AND has_headline) AS ts_with_finite_headline,
       count(*) FILTER (WHERE st IN ('complete', 'complete_with_warnings') AND has_marker) AS ts_with_marker,
       count(*) FILTER (WHERE st IN ('complete', 'complete_with_warnings') AND has_series AND has_headline AND has_marker) AS ts_all_three,
       count(*) FILTER (WHERE st IN ('complete', 'complete_with_warnings') AND strategy_status = 'published') AS published_ts,
       count(*) FILTER (WHERE st IN ('complete', 'complete_with_warnings') AND strategy_status = 'published' AND has_series AND has_headline AND has_marker) AS published_ts_all_three,
       count(*) FILTER (WHERE st IN ('pending', 'computing')) AS rows_pending_or_computing,
       count(*) FILTER (WHERE st IN ('pending', 'computing') AND has_series AND has_headline AND has_marker) AS pending_or_computing_all_three
  FROM t;
