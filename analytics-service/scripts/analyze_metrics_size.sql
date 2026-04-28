-- Phase 12 / D-07: probe metrics_json row size at p99.9 across all published strategies.
-- If p99.9 >= 800kB, kill-switch (phase12_kill_switch.py) cuts over heavy keys to sibling table.
--
-- Why pg_column_size and not octet_length(metrics_json::text)?
-- ------------------------------------------------------------
-- pg_column_size measures POST-TOAST-compressed on-disk bytes — the only quantity that
-- correlates with the 1MB JSONB decompression ceiling. octet_length on the JSON text
-- representation reports the pre-compression raw size which can differ 30-50% from
-- the value Postgres actually has to lift off-disk. M-03 (12-REVIEWS.md) requires
-- this single source of truth; phase12_kill_switch.py never re-measures via Python.
--
-- Output columns (CSV-friendly, order is contract-stable):
--   p50_bytes, p95_bytes, p99_bytes, p999_bytes, max_bytes, strategy_count
--
-- Usage:
--   psql "$DATABASE_URL" -tAF, -f analyze_metrics_size.sql
SELECT
    percentile_cont(0.50)  WITHIN GROUP (ORDER BY pg_column_size(metrics_json)) AS p50_bytes,
    percentile_cont(0.95)  WITHIN GROUP (ORDER BY pg_column_size(metrics_json)) AS p95_bytes,
    percentile_cont(0.99)  WITHIN GROUP (ORDER BY pg_column_size(metrics_json)) AS p99_bytes,
    percentile_cont(0.999) WITHIN GROUP (ORDER BY pg_column_size(metrics_json)) AS p999_bytes,
    max(pg_column_size(metrics_json)) AS max_bytes,
    count(*) AS strategy_count
FROM strategy_analytics
WHERE metrics_json IS NOT NULL;
