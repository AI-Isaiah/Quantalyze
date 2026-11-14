WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.user_id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
)
SELECT k.key_ordinal,
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', h.id,
             'allocator_id', h.allocator_id,
             'api_key_id', h.api_key_id,
             'venue', h.venue,
             'symbol', h.symbol,
             'asof', h.asof,
             'holding_type', h.holding_type,
             'side', h.side,
             'quantity', h.quantity,
             'value_usd', h.value_usd,
             'entry_price', h.entry_price,
             'mark_price', h.mark_price,
             'unrealized_pnl_usd', h.unrealized_pnl_usd,
             'cost_basis_usd', h.cost_basis_usd,
             'quantity_unit', h.quantity_unit,
             'created_at', h.created_at,
             'updated_at', h.updated_at
           )
           ORDER BY h.asof, h.id
         ) FILTER (WHERE h.id IS NOT NULL),
         '[]'::jsonb
       ) AS slice_rows,
       count(h.id) AS row_count,
       min(h.asof)::text AS first_day,
       max(h.asof)::text AS last_day
  FROM k
  LEFT JOIN public.allocator_holdings h ON h.api_key_id = k.id
 GROUP BY k.key_ordinal
 ORDER BY length(k.key_ordinal), k.key_ordinal;
