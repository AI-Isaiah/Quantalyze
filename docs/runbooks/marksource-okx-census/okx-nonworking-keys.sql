WITH RECURSIVE okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
user_key AS (
  SELECT a.label_no,
         k.id,
         lower(k.exchange) AS venue,
         (k.is_active
            AND k.disconnected_at IS NULL
            AND (k.sync_status IS NULL OR k.sync_status NOT IN ('revoked', 'sign_in_failed', 'error'))) AS working,
         k.account_share_kind,
         k.account_shared_with_api_key_id
    FROM public.api_keys k
    JOIN okx_account a ON a.allocator_id = k.user_id
),
marker_edge AS (
  SELECT u.label_no,
         u.id AS a_id,
         u.account_shared_with_api_key_id AS b_id
    FROM user_key u
    JOIN user_key v ON v.label_no = u.label_no AND v.id = u.account_shared_with_api_key_id
   WHERE u.account_share_kind IN ('duplicate', 'composite_member')
     AND u.account_shared_with_api_key_id <> u.id
),
reach AS (
  SELECT u.label_no,
         u.id AS key_id,
         u.id AS reached_id
    FROM user_key u
  UNION
  SELECT r.label_no,
         r.key_id,
         CASE WHEN e.a_id = r.reached_id THEN e.b_id ELSE e.a_id END
    FROM reach r
    JOIN marker_edge e
      ON e.label_no = r.label_no
     AND (e.a_id = r.reached_id OR e.b_id = r.reached_id)
),
key_group AS (
  SELECT label_no,
         key_id,
         min(reached_id::text) AS group_root
    FROM reach
   GROUP BY label_no, key_id
),
group_member AS (
  SELECT g.label_no,
         g.group_root,
         u.venue,
         u.working,
         (u.working OR NOT bool_or(u.working) OVER (PARTITION BY g.label_no, g.group_root)) AS deciding
    FROM key_group g
    JOIN user_key u ON u.label_no = g.label_no AND u.id = g.key_id
),
exchange_account AS (
  SELECT label_no,
         group_root,
         bool_or(working) AS has_working,
         count(DISTINCT venue) FILTER (WHERE deciding) AS deciding_venue_count,
         CASE WHEN count(DISTINCT venue) FILTER (WHERE deciding) = 1
              THEN min(venue) FILTER (WHERE deciding) END AS venue,
         CASE WHEN bool_and(venue = 'deribit') FILTER (WHERE deciding) THEN 'zero'
              WHEN NOT bool_or(working) THEN 'dead'
              WHEN count(DISTINCT venue) FILTER (WHERE deciding) > 1
                OR min(venue) FILTER (WHERE deciding) NOT IN ('deribit', 'bybit', 'binance', 'mt5', 'okx') THEN 'refused'
              ELSE 'crawled' END AS state
    FROM group_member
   GROUP BY label_no, group_root
),
dead_key AS (
  SELECT u.label_no,
         u.id AS key_id
    FROM user_key u
    JOIN key_group g ON g.label_no = u.label_no AND g.key_id = u.id
   WHERE NOT u.working
     AND u.venue <> 'deribit'
     AND NOT EXISTS (
       SELECT 1
         FROM key_group g2
         JOIN user_key w ON w.label_no = g2.label_no AND w.id = g2.key_id
        WHERE g2.label_no = g.label_no
          AND g2.group_root = g.group_root
          AND w.working
          AND w.venue = u.venue
     )
),
key_digest AS (
  SELECT u.label_no,
         md5(string_agg(u.id::text || ':' || CASE WHEN u.working THEN 't' ELSE 'f' END, '|' ORDER BY u.id::text COLLATE "C")) AS key_digest
    FROM user_key u
   GROUP BY u.label_no
),
account_counts AS (
  SELECT a.label_no,
         (SELECT count(*) FROM user_key u WHERE u.label_no = a.label_no) AS keys_total,
         count(e.group_root) AS exchange_accounts,
         count(*) FILTER (WHERE e.state = 'crawled' AND e.venue = 'okx') AS crawled_okx_accounts,
         count(*) FILTER (WHERE e.state = 'crawled' AND e.venue = 'bybit') AS crawled_bybit_accounts,
         count(*) FILTER (WHERE e.state = 'crawled' AND e.venue IN ('mt5', 'binance')) AS crawled_other_accounts,
         count(*) FILTER (WHERE e.state = 'dead') AS dead_exchange_accounts,
         count(*) FILTER (WHERE e.state = 'dead' AND e.venue = 'okx') AS dead_okx_accounts,
         count(*) FILTER (WHERE e.state = 'dead' AND e.venue = 'bybit') AS dead_bybit_accounts,
         count(*) FILTER (WHERE e.state = 'dead' AND e.venue = 'mt5') AS dead_mt5_accounts,
         count(*) FILTER (WHERE e.state = 'dead' AND e.venue = 'binance') AS dead_binance_accounts,
         count(*) FILTER (WHERE e.state = 'dead'
                            AND (e.venue IS NULL OR e.venue NOT IN ('okx', 'bybit', 'mt5', 'binance'))) AS dead_other_accounts,
         count(*) FILTER (WHERE e.state = 'zero') AS zero_contribution_accounts,
         count(*) FILTER (WHERE e.state = 'refused') AS refused_exchange_accounts
    FROM okx_account a
    LEFT JOIN exchange_account e ON e.label_no = a.label_no
   GROUP BY a.label_no
),
window_prediction AS (
  SELECT ac.label_no,
         CASE WHEN ac.crawled_okx_accounts > 0 THEN 90 ELSE 730 END AS predicted_window_days,
         CASE WHEN ac.crawled_okx_accounts > 0 THEN 89
              WHEN ac.crawled_bybit_accounts > 0 THEN 729
              ELSE 730 END AS window_back_days
    FROM account_counts ac
),
dead_span AS (
  SELECT d.label_no,
         d.key_id,
         min(h.asof) AS first_asof,
         max(h.asof) AS last_asof
    FROM dead_key d
    JOIN public.allocator_holdings h ON h.api_key_id = d.key_id
   GROUP BY d.label_no, d.key_id
),
dead_summary AS (
  SELECT a.label_no,
         (SELECT count(*) FROM dead_key d WHERE d.label_no = a.label_no) AS dead_keys,
         (SELECT count(*) FROM dead_span s WHERE s.label_no = a.label_no) AS dead_keys_with_holdings,
         (SELECT min((now() AT TIME ZONE 'UTC')::date - s.last_asof) FROM dead_span s WHERE s.label_no = a.label_no) AS dead_key_last_holdings_age_days
    FROM okx_account a
),
snapshot_day AS (
  SELECT a.label_no,
         s.asof,
         (count(*) OVER (PARTITION BY s.allocator_id, s.reconstructed_at) > 5) AS bulk_written
    FROM public.allocator_equity_snapshots s
    JOIN okx_account a ON a.allocator_id = s.allocator_id
),
day_counts AS (
  SELECT w.label_no,
         count(DISTINCT sd.asof) FILTER (
           WHERE NOT sd.bulk_written
             AND EXISTS (
               SELECT 1
                 FROM dead_span ds
                WHERE ds.label_no = sd.label_no
                  AND sd.asof >= ds.first_asof - 1
                  AND (sd.asof <= ds.last_asof + 7 OR sd.asof BETWEEN DATE '2026-09-29' AND DATE '2026-10-19')
             )
         ) AS in_window_days_overlapping_dead_key_holdings,
         count(DISTINCT sd.asof) FILTER (WHERE sd.bulk_written) AS in_window_days_written_in_bulk
    FROM window_prediction w
    JOIN snapshot_day sd
      ON sd.label_no = w.label_no
     AND sd.asof >= (now() AT TIME ZONE 'UTC')::date - w.window_back_days
   GROUP BY w.label_no
),
deleted_key_trace AS (
  SELECT w.label_no,
         count(DISTINCT al.entity_id) AS deleted_keys_seen_in_window
    FROM window_prediction w
    JOIN okx_account a ON a.label_no = w.label_no
    JOIN public.audit_log al ON al.user_id = a.allocator_id
   WHERE al.entity_type = 'api_key'
     AND al.action IN ('allocator.holdings.sync_completed', 'allocator.holdings.sync_failed')
     AND (al.created_at AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE 'UTC')::date - w.window_back_days - 8
     AND NOT EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = al.entity_id)
   GROUP BY w.label_no
)
SELECT 'a' || ac.label_no AS account_label,
       ac.keys_total,
       ac.exchange_accounts,
       ac.crawled_okx_accounts, ac.crawled_bybit_accounts, ac.crawled_other_accounts,
       ac.dead_exchange_accounts,
       ac.dead_okx_accounts, ac.dead_bybit_accounts, ac.dead_mt5_accounts, ac.dead_binance_accounts, ac.dead_other_accounts,
       ac.zero_contribution_accounts,
       ac.refused_exchange_accounts,
       dsum.dead_keys,
       wp.predicted_window_days,
       dsum.dead_keys_with_holdings,
       dsum.dead_key_last_holdings_age_days,
       coalesce(dc.in_window_days_overlapping_dead_key_holdings, 0) AS in_window_days_overlapping_dead_key_holdings,
       coalesce(dc.in_window_days_written_in_bulk, 0) AS in_window_days_written_in_bulk,
       coalesce(dkt.deleted_keys_seen_in_window, 0) AS deleted_keys_seen_in_window,
       kd.key_digest,
       CASE WHEN coalesce(dkt.deleted_keys_seen_in_window, 0) > 0
            THEN 'not recomputed (D-06)'
            WHEN dsum.dead_keys = 0
              OR (coalesce(dc.in_window_days_overlapping_dead_key_holdings, 0) = 0
                  AND coalesce(dc.in_window_days_written_in_bulk, 0) = 0)
            THEN 'rebuild'
            ELSE 'not recomputed (D-06)' END AS p7_outcome
  FROM account_counts ac
  JOIN window_prediction wp ON wp.label_no = ac.label_no
  JOIN dead_summary dsum ON dsum.label_no = ac.label_no
  JOIN key_digest kd ON kd.label_no = ac.label_no
  LEFT JOIN day_counts dc ON dc.label_no = ac.label_no
  LEFT JOIN deleted_key_trace dkt ON dkt.label_no = ac.label_no
 ORDER BY ac.label_no;
