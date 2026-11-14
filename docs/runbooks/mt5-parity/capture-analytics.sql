WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.user_id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
)
SELECT k.key_ordinal,
       COALESCE(
         jsonb_agg(to_jsonb(sa.*) ORDER BY sa.strategy_id) FILTER (WHERE sa.id IS NOT NULL),
         '[]'::jsonb
       ) AS slice_rows,
       count(sa.id) AS row_count,
       NULL::text AS first_day,
       NULL::text AS last_day,
       COALESCE(
         jsonb_agg(
           CASE WHEN jsonb_typeof(sa.returns_series) = 'array'
                THEN jsonb_array_length(sa.returns_series) END
           ORDER BY sa.strategy_id
         ) FILTER (WHERE sa.id IS NOT NULL),
         '[]'::jsonb
       ) AS returns_series_len,
       COALESCE(
         jsonb_agg(
           CASE WHEN jsonb_typeof(sa.daily_returns) = 'array'
                THEN jsonb_array_length(sa.daily_returns) END
           ORDER BY sa.strategy_id
         ) FILTER (WHERE sa.id IS NOT NULL),
         '[]'::jsonb
       ) AS daily_returns_len
  FROM k
  LEFT JOIN public.strategies s ON s.api_key_id = k.id
  LEFT JOIN public.strategy_analytics sa ON sa.strategy_id = s.id
 GROUP BY k.key_ordinal
 ORDER BY length(k.key_ordinal), k.key_ordinal;
