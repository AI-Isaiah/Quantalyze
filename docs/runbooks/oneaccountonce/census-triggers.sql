SELECT cl.relname AS table_name,
       t.tgname AS trigger_name,
       CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE'
            WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF'
            ELSE 'AFTER' END AS timing,
       concat_ws(' OR ',
                 CASE WHEN (t.tgtype & 4) <> 0 THEN 'INSERT' END,
                 CASE WHEN (t.tgtype & 8) <> 0 THEN 'DELETE' END,
                 CASE WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE' END,
                 CASE WHEN (t.tgtype & 32) <> 0 THEN 'TRUNCATE' END) AS events,
       CASE WHEN (t.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS granularity,
       t.tgenabled AS enabled,
       p.proname AS function_name
  FROM pg_trigger t
  JOIN pg_class cl ON cl.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE NOT t.tgisinternal
   AND n.nspname = 'public'
   AND cl.relname = ANY (ARRAY[
     'api_keys', 'strategies', 'allocator_holdings', 'csv_daily_returns', 'compute_jobs',
     'api_key_nav_marks', 'mt5_server_clock_readings', 'key_permission_audit',
     'strategy_analytics', 'strategy_analytics_series', 'trades', 'positions',
     'position_snapshots', 'funding_fees', 'match_candidates', 'reconciliation_reports',
     'strategy_verifications'
   ])
 ORDER BY cl.relname, t.tgname;
