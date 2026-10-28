WITH okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
keys AS (
  SELECT a.label_no,
         k.id,
         lower(k.exchange) AS exchange,
         (k.is_active
            AND k.disconnected_at IS NULL
            AND (k.sync_status IS NULL OR k.sync_status NOT IN ('revoked', 'sign_in_failed', 'error'))) AS working,
         (k.venue_account_id IS NULL AND k.account_share_kind IS NULL) AS identity_unknown
    FROM public.api_keys k
    JOIN okx_account a ON a.allocator_id = k.user_id
),
key_counts AS (
  SELECT label_no,
         count(*) AS keys_total,
         count(*) FILTER (WHERE working) AS keys_working,
         count(*) FILTER (WHERE exchange = 'okx' AND working) AS okx_working,
         count(*) FILTER (WHERE exchange = 'bybit' AND working) AS bybit_working,
         count(*) FILTER (WHERE exchange = 'binance' AND working) AS binance_working,
         count(*) FILTER (WHERE exchange = 'mt5' AND working) AS mt5_working,
         count(*) FILTER (WHERE exchange = 'deribit' AND working) AS deribit_working,
         count(*) FILTER (WHERE exchange NOT IN ('okx', 'bybit', 'binance', 'mt5', 'deribit')) AS keys_on_a_venue_the_rebuild_refuses,
         count(*) FILTER (WHERE exchange IN ('okx', 'bybit', 'binance') AND working AND identity_unknown) AS working_keys_with_unknown_account
    FROM keys
   GROUP BY label_no
),
snapshot_counts AS (
  SELECT a.label_no,
         count(s.asof) AS snapshot_days,
         count(*) FILTER (WHERE s.asof < (now() AT TIME ZONE 'UTC')::date - 89) AS days_before_the_90_day_window,
         count(*) FILTER (WHERE s.asof >= (now() AT TIME ZONE 'UTC')::date - 89) AS days_in_the_90_day_window,
         count(*) FILTER (WHERE s.bulk_written
                            AND s.asof >= (now() AT TIME ZONE 'UTC')::date - 89) AS in_window_days_written_in_bulk
    FROM okx_account a
    LEFT JOIN (
      SELECT x.allocator_id,
             x.asof,
             (count(*) OVER (PARTITION BY x.allocator_id, x.reconstructed_at) > 5) AS bulk_written
        FROM public.allocator_equity_snapshots x
    ) s ON s.allocator_id = a.allocator_id
   GROUP BY a.label_no
),
boundary_counts AS (
  SELECT a.label_no,
         count(d.kind) AS rebuild_boundary_rows
    FROM okx_account a
    LEFT JOIN public.allocator_equity_derived d
      ON d.allocator_id = a.allocator_id AND d.kind = 'snapshot_rebuild_boundary'
   GROUP BY a.label_no
),
job_counts AS (
  SELECT k.label_no,
         count(j.id) AS reconstruct_jobs_in_flight
    FROM keys k
    LEFT JOIN public.compute_jobs j
      ON j.api_key_id = k.id
     AND j.kind = 'reconstruct_allocator_history'
     AND j.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
   GROUP BY k.label_no
)
SELECT 'a' || kc.label_no AS account_label,
       kc.keys_total, kc.keys_working,
       kc.okx_working, kc.bybit_working, kc.binance_working, kc.mt5_working, kc.deribit_working,
       kc.keys_on_a_venue_the_rebuild_refuses,
       kc.working_keys_with_unknown_account,
       90 AS predicted_window_days,
       sc.snapshot_days, sc.days_in_the_90_day_window, sc.days_before_the_90_day_window,
       sc.in_window_days_written_in_bulk,
       bc.rebuild_boundary_rows,
       jc.reconstruct_jobs_in_flight
  FROM key_counts kc
  JOIN snapshot_counts sc USING (label_no)
  JOIN boundary_counts bc USING (label_no)
  JOIN job_counts jc USING (label_no)
 ORDER BY kc.label_no;
