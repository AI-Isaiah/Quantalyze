WITH latest AS (
  SELECT api_key_id, max(asof) AS latest_asof
    FROM public.allocator_holdings
   GROUP BY api_key_id
),
gap AS (
  SELECT h.allocator_id, h.api_key_id, h.venue, h.symbol, h.asof, h.quantity
    FROM public.allocator_holdings h
    JOIN latest l ON l.api_key_id = h.api_key_id AND l.latest_asof = h.asof
   WHERE h.holding_type = 'spot'
     AND h.quantity > 0
     AND h.mark_price <= 0
)
SELECT venue, symbol, asof, quantity, last_priced_mark, last_priced_days_ago, estimated_usd, share_of_account_level
  FROM (
    SELECT g.venue,
           g.symbol,
           g.asof,
           g.quantity,
           p.mark_price AS last_priced_mark,
           (g.asof - p.asof) AS last_priced_days_ago,
           g.quantity * p.mark_price AS estimated_usd,
           (g.quantity * p.mark_price) / nullif(lv.level_usd, 0) AS share_of_account_level,
           0 AS grp
      FROM gap g
      LEFT JOIN LATERAL (
        SELECT q.mark_price, q.asof
          FROM public.allocator_holdings q
         WHERE q.allocator_id = g.allocator_id
           AND q.api_key_id = g.api_key_id
           AND q.symbol = g.symbol
           AND q.holding_type = 'spot'
           AND q.mark_price > 0
           AND q.asof < g.asof
         ORDER BY q.asof DESC
         LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN r.holding_type = 'spot' THEN r.value_usd
                        ELSE coalesce(r.unrealized_pnl_usd, 0) END) AS level_usd
          FROM public.allocator_holdings r
         WHERE r.api_key_id = g.api_key_id AND r.asof = g.asof
      ) lv ON true
    UNION ALL
    SELECT 'spot rows examined (latest day of each key)',
           count(*)::text,
           NULL::date,
           NULL::numeric,
           NULL::numeric,
           NULL::integer,
           NULL::numeric,
           NULL::numeric,
           1
      FROM public.allocator_holdings h
      JOIN latest l ON l.api_key_id = h.api_key_id AND l.latest_asof = h.asof
     WHERE h.holding_type = 'spot'
  ) report
 ORDER BY grp, share_of_account_level DESC NULLS FIRST, venue, symbol;
