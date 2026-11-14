WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.user_id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
)
SELECT k.key_ordinal,
       COALESCE(
         jsonb_agg(to_jsonb(e.*) ORDER BY e.computed_at) FILTER (WHERE e.kind IS NOT NULL),
         '[]'::jsonb
       ) AS slice_rows,
       count(e.kind) AS row_count,
       NULL::text AS first_day,
       NULL::text AS last_day
  FROM k
  LEFT JOIN public.allocator_equity_derived e
    ON e.kind = 'equity_curve'
   AND e.allocator_id = k.user_id
 GROUP BY k.key_ordinal
 ORDER BY length(k.key_ordinal), k.key_ordinal;
