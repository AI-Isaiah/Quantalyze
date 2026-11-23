WITH keyset AS (
  SELECT $q$SELECT k.id FROM public.api_keys k JOIN public.api_keys h ON h.id = k.account_shared_with_api_key_id WHERE k.account_share_kind = 'duplicate' AND h.user_id = k.user_id$q$ AS key_sql,
         $q$SELECT s.id FROM public.strategies s WHERE s.api_key_id IN (SELECT k.id FROM public.api_keys k JOIN public.api_keys h ON h.id = k.account_shared_with_api_key_id WHERE k.account_share_kind = 'duplicate' AND h.user_id = k.user_id)$q$ AS strategy_sql
),
fk AS (
  SELECT 'fk' AS row_kind,
         cl.relname AS referencing_table,
         a.attname AS column_name,
         ref.relname AS references_table,
         CASE c.confdeltype
           WHEN 'a' THEN 'NO ACTION'
           WHEN 'r' THEN 'RESTRICT'
           WHEN 'c' THEN 'CASCADE'
           WHEN 'n' THEN 'SET NULL'
           WHEN 'd' THEN 'SET DEFAULT'
         END AS on_delete,
         (n.nspname = 'public' AND cl.relname = ANY (ARRAY[
            'api_keys', 'strategies', 'allocator_holdings', 'csv_daily_returns', 'compute_jobs',
            'api_key_nav_marks', 'mt5_server_clock_readings', 'key_permission_audit',
            'strategy_analytics', 'strategy_analytics_series', 'trades', 'positions',
            'position_snapshots', 'funding_fees', 'match_candidates', 'reconciliation_reports',
            'strategy_verifications'
         ])) AS in_confirmed_list,
         format('SELECT count(*) AS n FROM %I.%I WHERE %I::text IN (SELECT id::text FROM (%s) ids)',
                n.nspname, cl.relname, a.attname,
                CASE WHEN ref.relname = 'api_keys' THEN ks.key_sql ELSE ks.strategy_sql END) AS count_sql
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_class ref ON ref.oid = c.confrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    CROSS JOIN keyset ks
   WHERE c.contype = 'f'
     AND c.confrelid IN ('public.api_keys'::regclass, 'public.strategies'::regclass)
),
non_fk AS (
  SELECT 'non_fk_column' AS row_kind,
         cl.relname AS referencing_table,
         a.attname AS column_name,
         CASE a.attname WHEN 'api_key_id' THEN 'api_keys' ELSE 'strategies' END AS references_table,
         NULL::text AS on_delete,
         NULL::boolean AS in_confirmed_list,
         format('SELECT count(*) AS n FROM %I.%I WHERE %I::text IN (SELECT id::text FROM (%s) ids)',
                n.nspname, cl.relname, a.attname,
                CASE a.attname WHEN 'api_key_id' THEN ks.key_sql ELSE ks.strategy_sql END) AS count_sql
    FROM pg_attribute a
    JOIN pg_class cl ON cl.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    CROSS JOIN keyset ks
   WHERE n.nspname = 'public'
     AND cl.relkind IN ('r', 'p')
     AND a.attname IN ('api_key_id', 'strategy_id')
     AND NOT a.attisdropped
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint c
        WHERE c.conrelid = a.attrelid
          AND c.contype = 'f'
          AND a.attnum = ANY (c.conkey)
     )
),
derived AS (
  SELECT 'non_fk_derived' AS row_kind,
         'allocator_equity_derived' AS referencing_table,
         'kind = key_inputs:<key id>' AS column_name,
         'api_keys' AS references_table,
         NULL::text AS on_delete,
         NULL::boolean AS in_confirmed_list,
         format('SELECT count(*) AS n FROM public.allocator_equity_derived d WHERE d.kind IN (SELECT ''key_inputs:'' || id::text FROM (%s) ids)',
                ks.key_sql) AS count_sql
    FROM keyset ks
),
all_rows AS (
  SELECT * FROM fk
  UNION ALL SELECT * FROM non_fk
  UNION ALL SELECT * FROM derived
)
SELECT row_kind,
       referencing_table,
       column_name,
       references_table,
       on_delete,
       in_confirmed_list,
       (xpath('/row/n/text()', query_to_xml(count_sql, false, true, '')))[1]::text::bigint AS rows_referencing
  FROM all_rows
 ORDER BY row_kind, referencing_table, column_name, references_table;
