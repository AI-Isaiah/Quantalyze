WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.user_id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
)
SELECT k.key_ordinal,
       COALESCE(
         jsonb_agg(to_jsonb(m.*) ORDER BY m.mark_day, m.id) FILTER (WHERE m.id IS NOT NULL),
         '[]'::jsonb
       ) AS slice_rows,
       count(m.id) AS row_count,
       min(m.mark_day)::text AS first_day,
       max(m.mark_day)::text AS last_day
  FROM k
  LEFT JOIN public.api_key_nav_marks m ON m.api_key_id = k.id
 GROUP BY k.key_ordinal
 ORDER BY length(k.key_ordinal), k.key_ordinal;
