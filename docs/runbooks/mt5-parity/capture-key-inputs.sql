WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.user_id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
)
SELECT k.key_ordinal,
       COALESCE(
         jsonb_agg(to_jsonb(d.*) ORDER BY d.computed_at) FILTER (WHERE d.kind IS NOT NULL),
         '[]'::jsonb
       ) AS slice_rows,
       count(d.kind) AS row_count,
       NULL::text AS first_day,
       NULL::text AS last_day
  FROM k
  LEFT JOIN public.allocator_equity_derived d ON d.kind = 'key_inputs:' || k.id::text
 GROUP BY k.key_ordinal
 ORDER BY length(k.key_ordinal), k.key_ordinal;
