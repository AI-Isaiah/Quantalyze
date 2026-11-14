WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.user_id,
         ak.account_currency,
         ak.label,
         ak.created_at
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
)
SELECT k.key_ordinal,
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'api_key_id', k.id,
             'allocator_id', k.user_id,
             'label', k.label,
             'account_currency', k.account_currency,
             'strategy_id', s.id,
             'strategy_status', s.status,
             'asset_class', s.asset_class,
             'key_created_at', k.created_at
           )
           ORDER BY s.created_at, s.id
         ) FILTER (WHERE k.id IS NOT NULL),
         '[]'::jsonb
       ) AS slice_rows,
       count(k.id) AS row_count,
       NULL::text AS first_day,
       NULL::text AS last_day
  FROM k
  LEFT JOIN public.strategies s ON s.api_key_id = k.id
 GROUP BY k.key_ordinal
 ORDER BY length(k.key_ordinal), k.key_ordinal;
