WITH dup AS (
  SELECT k.id
    FROM public.api_keys k
    JOIN public.api_keys h ON h.id = k.account_shared_with_api_key_id
   WHERE k.account_share_kind = 'duplicate'
     AND h.user_id = k.user_id
)
SELECT 'strategy' AS row_kind,
       s.id,
       s.user_id,
       s.status,
       s.source,
       s.created_at,
       s.api_key_id
  FROM public.strategies s
 WHERE s.api_key_id IN (SELECT id FROM dup)
UNION ALL
SELECT 'strategy_keys_link' AS row_kind,
       sk.strategy_id AS id,
       sk.owner_id AS user_id,
       s.status,
       s.source,
       sk.created_at,
       sk.api_key_id
  FROM public.strategy_keys sk
  JOIN public.strategies s ON s.id = sk.strategy_id
 WHERE sk.api_key_id IN (SELECT id FROM dup)
 ORDER BY row_kind, user_id, created_at, id;
