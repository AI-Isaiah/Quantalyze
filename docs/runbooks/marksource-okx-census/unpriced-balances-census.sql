WITH gap AS (
  SELECT h.allocator_id, h.api_key_id, h.venue, h.symbol, h.asof, h.quantity
    FROM public.allocator_holdings h
   WHERE h.holding_type = 'spot'
     AND h.quantity > 0
     AND h.mark_price <= 0
),
sized AS (
  SELECT g.*,
         g.quantity * p.mark_price AS estimated_usd,
         (g.asof - p.asof) AS price_age_days
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
),
account_level AS (
  SELECT h.api_key_id,
         h.asof,
         sum(CASE WHEN h.holding_type = 'spot' THEN h.value_usd
                  ELSE coalesce(h.unrealized_pnl_usd, 0) END) AS level_usd
    FROM public.allocator_holdings h
   WHERE EXISTS (SELECT 1 FROM gap g WHERE g.api_key_id = h.api_key_id AND g.asof = h.asof)
   GROUP BY h.api_key_id, h.asof
),
latest AS (
  SELECT api_key_id, max(asof) AS latest_asof
    FROM public.allocator_holdings
   GROUP BY api_key_id
),
scored AS (
  SELECT s.*,
         (s.asof = l.latest_asof) AS is_latest_day_of_its_key,
         CASE
           WHEN s.estimated_usd IS NULL THEN '1 unsizable: never priced by this key'
           WHEN coalesce(al.level_usd, 0) <= 0 THEN '2 account level not positive'
           WHEN s.estimated_usd / al.level_usd < 0.0001 THEN '3 below 0.01 percent'
           WHEN s.estimated_usd / al.level_usd < 0.001 THEN '4 0.01 to 0.1 percent'
           WHEN s.estimated_usd / al.level_usd < 0.01 THEN '5 0.1 to 1 percent'
           ELSE '6 at least 1 percent'
         END AS size_bucket
    FROM sized s
    JOIN latest l ON l.api_key_id = s.api_key_id
    LEFT JOIN account_level al ON al.api_key_id = s.api_key_id AND al.asof = s.asof
)
SELECT scope, size_bucket, unpriced_balance_rows, keys, symbols, days
  FROM (
    SELECT GROUPING(is_latest_day_of_its_key) AS grp,
           is_latest_day_of_its_key AS latest,
           CASE WHEN GROUPING(is_latest_day_of_its_key) = 1 THEN 'all days'
                WHEN is_latest_day_of_its_key THEN 'latest day of each key'
                ELSE 'earlier days' END AS scope,
           size_bucket,
           count(*) AS unpriced_balance_rows,
           count(DISTINCT api_key_id) AS keys,
           count(DISTINCT symbol) AS symbols,
           count(DISTINCT asof) AS days
      FROM scored
     GROUP BY GROUPING SETS ((is_latest_day_of_its_key, size_bucket), (size_bucket))
    UNION ALL
    SELECT 2,
           NULL::boolean,
           'all days',
           'spot rows examined',
           count(*),
           count(DISTINCT api_key_id),
           count(DISTINCT symbol),
           count(DISTINCT asof)
      FROM public.allocator_holdings
     WHERE holding_type = 'spot'
  ) report
 ORDER BY grp, latest DESC, size_bucket;
