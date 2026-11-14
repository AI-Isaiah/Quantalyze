WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.user_id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
),
w AS (
  SELECT k.key_ordinal,
         min(r.date) - 7 AS lo_day,
         max(r.date) AS hi_day
    FROM k
    JOIN public.csv_daily_returns r
      ON r.api_key_id = k.id
      OR r.strategy_id IN (SELECT s.id FROM public.strategies s WHERE s.api_key_id = k.id)
   WHERE EXISTS (
           SELECT 1
             FROM public.api_key_nav_marks m
            WHERE m.api_key_id = k.id
              AND m.native_unit IS NOT NULL
         )
   GROUP BY k.key_ordinal
)
SELECT k.key_ordinal,
       COALESCE(
         jsonb_agg(to_jsonb(b.*) ORDER BY b.date) FILTER (WHERE b.date IS NOT NULL),
         '[]'::jsonb
       ) AS slice_rows,
       count(b.date) AS row_count,
       min(b.date)::text AS first_day,
       max(b.date)::text AS last_day
  FROM k
  LEFT JOIN w ON w.key_ordinal = k.key_ordinal
  LEFT JOIN public.benchmark_prices b
    ON b.symbol = 'BTC'
   AND b.date BETWEEN w.lo_day AND w.hi_day
 GROUP BY k.key_ordinal
 ORDER BY length(k.key_ordinal), k.key_ordinal;
