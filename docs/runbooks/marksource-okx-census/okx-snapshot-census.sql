WITH okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
okx_day AS (
  SELECT h.allocator_id,
         h.asof,
         count(DISTINCT h.api_key_id) AS okx_keys,
         count(*) FILTER (WHERE h.holding_type = 'derivative'
                            AND h.unrealized_pnl_usd IS NOT NULL) AS derivative_rows,
         coalesce(sum(h.unrealized_pnl_usd) FILTER (WHERE h.holding_type = 'derivative'), 0) AS okx_upnl_usd
    FROM public.allocator_holdings h
    JOIN okx_account a ON a.allocator_id = h.allocator_id
   WHERE lower(h.venue) = 'okx'
   GROUP BY h.allocator_id, h.asof
),
snapshot_day AS (
  SELECT a.label_no,
         s.allocator_id,
         s.asof,
         s.value_usd,
         (count(*) OVER (PARTITION BY s.allocator_id, s.reconstructed_at) > 5) AS bulk_written,
         (s.asof >= (now() AT TIME ZONE 'UTC')::date - 89) AS in_okx_rebuild_window
    FROM public.allocator_equity_snapshots s
    JOIN okx_account a ON a.allocator_id = s.allocator_id
),
joined AS (
  SELECT sd.*,
         d.okx_keys,
         d.derivative_rows,
         d.okx_upnl_usd,
         (NOT sd.bulk_written AND d.derivative_rows > 0 AND d.okx_upnl_usd <> 0) AS suspect,
         abs(d.okx_upnl_usd) / nullif(abs(sd.value_usd), 0) AS overcount_share
    FROM snapshot_day sd
    LEFT JOIN okx_day d
      ON d.allocator_id = sd.allocator_id AND d.asof = sd.asof
)
SELECT CASE WHEN GROUPING(label_no) = 1 THEN 'all' ELSE 'a' || label_no END AS account_label,
       count(*) AS snapshot_days,
       count(*) FILTER (WHERE bulk_written) AS days_written_in_bulk,
       count(*) FILTER (WHERE bulk_written AND in_okx_rebuild_window) AS days_written_in_bulk_inside_window,
       count(*) FILTER (WHERE suspect) AS suspect_days,
       min(asof) FILTER (WHERE suspect) AS first_suspect_asof,
       max(asof) FILTER (WHERE suspect) AS last_suspect_asof,
       count(*) FILTER (WHERE suspect AND in_okx_rebuild_window) AS suspect_days_in_window,
       count(*) FILTER (WHERE suspect AND NOT in_okx_rebuild_window) AS suspect_days_outside_window,
       count(*) FILTER (WHERE suspect AND abs(okx_upnl_usd) > greatest(1, 0.005 * abs(value_usd))) AS suspect_days_over_tolerance,
       count(*) FILTER (WHERE suspect AND okx_keys > 1) AS suspect_days_with_several_okx_keys,
       count(*) FILTER (WHERE NOT bulk_written AND okx_keys IS NULL) AS refresh_days_with_no_okx_holdings_that_day,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY overcount_share) FILTER (WHERE suspect)::numeric, 5) AS median_overcount_share,
       round(max(overcount_share) FILTER (WHERE suspect)::numeric, 5) AS max_overcount_share,
       round(sum(abs(okx_upnl_usd)) FILTER (WHERE suspect)::numeric, 2) AS sum_abs_overcount_usd,
       round(max(abs(okx_upnl_usd)) FILTER (WHERE suspect)::numeric, 2) AS max_abs_overcount_usd
  FROM joined
 GROUP BY GROUPING SETS ((label_no), ())
 ORDER BY GROUPING(label_no), label_no;
