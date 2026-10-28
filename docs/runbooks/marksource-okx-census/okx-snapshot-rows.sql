WITH okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
)
SELECT 'a' || a.label_no AS account_label,
       s.asof,
       s.value_usd,
       s.source,
       s.history_depth_months,
       s.pre_terminus_balance_unknown,
       s.reconstructed_at
  FROM public.allocator_equity_snapshots s
  JOIN okx_account a ON a.allocator_id = s.allocator_id
 ORDER BY a.label_no, s.asof;
