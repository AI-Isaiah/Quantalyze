WITH dup AS (
  SELECT k.id,
         k.user_id,
         k.exchange,
         k.created_at,
         k.disconnected_at
    FROM public.api_keys k
    JOIN public.api_keys h ON h.id = k.account_shared_with_api_key_id
   WHERE k.account_share_kind = 'duplicate'
     AND h.user_id = k.user_id
),
mt5_ordinal AS (
  SELECT m.id,
         'k' || row_number() OVER (ORDER BY m.created_at, m.id) AS key_ordinal
    FROM public.api_keys m
   WHERE m.exchange = 'mt5'
)
SELECT d.id,
       d.user_id,
       d.exchange,
       d.disconnected_at IS NOT NULL AS is_disconnected,
       EXISTS (SELECT 1 FROM public.api_keys o WHERE o.account_shared_with_api_key_id = d.id) AS is_holder,
       EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.api_key_id = d.id) AS in_strategy_keys,
       EXISTS (
         SELECT 1
           FROM public.strategy_keys sk
           JOIN public.strategies s ON s.id = sk.strategy_id
          WHERE sk.api_key_id = d.id
            AND s.status = 'published'
       ) AS in_published_composite,
       (SELECT count(*)
          FROM public.api_keys o
         WHERE o.user_id = d.user_id
           AND o.id NOT IN (SELECT id FROM dup)) AS other_key_count,
       mo.key_ordinal
  FROM dup d
  LEFT JOIN mt5_ordinal mo ON mo.id = d.id
 ORDER BY d.exchange, d.user_id, d.created_at, d.id;
