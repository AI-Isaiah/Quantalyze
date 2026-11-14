WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.user_id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
)
SELECT k.key_ordinal,
       COALESCE(
         jsonb_agg(to_jsonb(s.*) ORDER BY s.created_at, s.id) FILTER (WHERE s.id IS NOT NULL),
         '[]'::jsonb
       ) AS slice_rows,
       count(s.id) AS row_count,
       NULL::text AS first_day,
       NULL::text AS last_day
  FROM k
  LEFT JOIN public.strategies s ON s.api_key_id = k.id
 GROUP BY k.key_ordinal
 ORDER BY length(k.key_ordinal), k.key_ordinal;
