WITH okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
okx_day AS (
  SELECT a.label_no,
         h.allocator_id,
         h.asof,
         coalesce(sum(h.value_usd) FILTER (WHERE h.holding_type = 'spot'
                                             AND upper(h.symbol) = 'USDT'), 0) AS usdt_spot_value_usd,
         count(*) FILTER (WHERE h.holding_type = 'spot'
                            AND upper(h.symbol) = 'USDT') AS usdt_spot_rows,
         count(*) FILTER (WHERE h.holding_type = 'derivative'
                            AND h.unrealized_pnl_usd IS NOT NULL) AS derivative_rows,
         coalesce(sum(h.unrealized_pnl_usd) FILTER (WHERE h.holding_type = 'derivative'), 0) AS okx_upnl_usd
    FROM public.allocator_holdings h
    JOIN okx_account a ON a.allocator_id = h.allocator_id
   WHERE lower(h.venue) = 'okx'
     AND h.asof >= (now() AT TIME ZONE 'UTC')::date - 730
   GROUP BY a.label_no, h.allocator_id, h.asof
),
scored AS (
  SELECT d.*,
         (d.usdt_spot_rows > 0 AND d.derivative_rows > 0 AND d.okx_upnl_usd <> 0) AS suspect,
         abs(d.okx_upnl_usd) / nullif(abs(d.usdt_spot_value_usd), 0) AS overcount_share
    FROM okx_day d
)
SELECT CASE WHEN GROUPING(label_no) = 1 THEN 'all' ELSE 'a' || label_no END AS account_label,
       count(*) AS okx_holdings_days,
       min(asof) AS first_asof,
       max(asof) AS last_asof,
       count(*) FILTER (WHERE suspect) AS usdt_row_days_carrying_open_profit,
       count(*) FILTER (WHERE suspect AND asof >= (now() AT TIME ZONE 'UTC')::date - 89) AS of_which_last_90_days,
       count(*) FILTER (WHERE suspect AND overcount_share > 0.005) AS of_which_over_half_a_percent_of_the_usdt_row,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY overcount_share) FILTER (WHERE suspect)::numeric, 5) AS median_share_of_the_usdt_row,
       round(max(overcount_share) FILTER (WHERE suspect)::numeric, 5) AS max_share_of_the_usdt_row,
       round(max(abs(okx_upnl_usd)) FILTER (WHERE suspect)::numeric, 2) AS max_abs_overcount_usd
  FROM scored
 GROUP BY GROUPING SETS ((label_no), ())
 ORDER BY GROUPING(label_no), label_no;
