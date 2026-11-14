WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         row_number() OVER (ORDER BY ak.created_at, ak.id) AS ord,
         ak.id,
         ak.user_id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
)
SELECT k.key_ordinal,
       k.id AS api_key_id,
       (SELECT count(*)
          FROM public.strategy_analytics a
          JOIN public.strategies s ON s.id = a.strategy_id
         WHERE s.api_key_id = k.id) AS analytics_rows,
       (SELECT max(a.computed_at)
          FROM public.strategy_analytics a
          JOIN public.strategies s ON s.id = a.strategy_id
         WHERE s.api_key_id = k.id) AS analytics_max_computed_at,
       (SELECT count(*)
          FROM public.api_key_nav_marks m
         WHERE m.api_key_id = k.id) AS marks_count,
       (SELECT max(m.created_at)
          FROM public.api_key_nav_marks m
         WHERE m.api_key_id = k.id) AS marks_max_created_at,
       (SELECT max(e.computed_at)
          FROM public.allocator_equity_derived e
         WHERE e.kind = 'key_inputs:' || k.id::text) AS key_inputs_computed_at,
       (SELECT count(*)
          FROM public.csv_daily_returns r
         WHERE r.api_key_id = k.id)
       + (SELECT count(*)
            FROM public.csv_daily_returns r
            JOIN public.strategies s ON s.id = r.strategy_id
           WHERE s.api_key_id = k.id) AS returns_count,
       GREATEST(
         (SELECT max(r.updated_at)
            FROM public.csv_daily_returns r
           WHERE r.api_key_id = k.id),
         (SELECT max(r.updated_at)
            FROM public.csv_daily_returns r
            JOIN public.strategies s ON s.id = r.strategy_id
           WHERE s.api_key_id = k.id)
       ) AS returns_max_updated_at,
       (SELECT max(e.computed_at)
          FROM public.allocator_equity_derived e
         WHERE e.kind = 'equity_curve' AND e.allocator_id = k.user_id) AS equity_curve_computed_at,
       (SELECT max(h.updated_at)
          FROM public.allocator_holdings h
         WHERE h.api_key_id = k.id) AS holdings_max_updated_at
  FROM k
 ORDER BY k.ord;
