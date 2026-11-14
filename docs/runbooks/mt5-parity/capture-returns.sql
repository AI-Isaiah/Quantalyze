WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.user_id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
)
SELECT k.key_ordinal,
       COALESCE(
         jsonb_agg(to_jsonb(r.*) ORDER BY r.date, r.id) FILTER (WHERE r.id IS NOT NULL),
         '[]'::jsonb
       ) AS slice_rows,
       count(r.id) AS row_count,
       min(r.date)::text AS first_day,
       max(r.date)::text AS last_day
  FROM k
  LEFT JOIN public.csv_daily_returns r
    ON r.api_key_id = k.id
    OR r.strategy_id IN (SELECT s.id FROM public.strategies s WHERE s.api_key_id = k.id)
 GROUP BY k.key_ordinal
 ORDER BY length(k.key_ordinal), k.key_ordinal;
