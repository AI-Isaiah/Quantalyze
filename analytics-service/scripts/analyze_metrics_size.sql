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
-- Output: rows of (k, v) where k is a string label and v is the numeric value as text.
-- P2022 (audit-2026-05-07 round 2): the previous positional CSV layout meant a SQL
-- re-order would silently shift the parsed p999 to a different percentile. Keyed
-- output makes the parse contract column-order-independent and forces the caller
-- to opt into specific keys.
--
-- Emitted keys (each appears exactly once):
--   relation_visible, p50, p95, p99, p999, max, count, total_rows
--
-- `relation_visible` is `t` when `to_regclass('public.strategy_analytics')`
-- resolves AND the current role has SELECT privilege (regardless of RLS
-- row filtering). It distinguishes (RLS hides every row → count=0,
-- total_rows=0, relation_visible=t) from (table missing / role lacks
-- SELECT → count=0, total_rows=0, relation_visible=f). Without it, the
-- Python parser would mis-diagnose a permissions failure as "wrong DB".
--
-- `count` is the number of rows with non-NULL metrics_json (the rows the
-- percentile is computed over). `total_rows` is the unfiltered row count;
-- the Python parser uses (total_rows > 0 AND count == 0) to emit a
-- "table populated but no metrics yet" diagnostic distinct from "table
-- empty / wrong DB".
--
-- Usage:
--   psql --dbname "$DATABASE_URL" -tAF, -f analyze_metrics_size.sql
WITH visibility AS (
    SELECT
        to_regclass('public.strategy_analytics') IS NOT NULL
        AND has_table_privilege('public.strategy_analytics', 'SELECT')
        AS relation_visible
),
stats AS (
    SELECT
        percentile_cont(0.50)  WITHIN GROUP (ORDER BY pg_column_size(metrics_json)) AS p50,
        percentile_cont(0.95)  WITHIN GROUP (ORDER BY pg_column_size(metrics_json)) AS p95,
        percentile_cont(0.99)  WITHIN GROUP (ORDER BY pg_column_size(metrics_json)) AS p99,
        percentile_cont(0.999) WITHIN GROUP (ORDER BY pg_column_size(metrics_json)) AS p999,
        max(pg_column_size(metrics_json)) AS max_bytes,
        count(*) AS strategy_count
    FROM strategy_analytics
    WHERE metrics_json IS NOT NULL
),
unfiltered AS (
    SELECT count(*) AS total_rows FROM strategy_analytics
)
SELECT 'relation_visible' AS k, relation_visible::text AS v FROM visibility
UNION ALL SELECT 'p50',        p50::text                FROM stats
UNION ALL SELECT 'p95',        p95::text                FROM stats
UNION ALL SELECT 'p99',        p99::text                FROM stats
UNION ALL SELECT 'p999',       p999::text               FROM stats
UNION ALL SELECT 'max',        max_bytes::text          FROM stats
UNION ALL SELECT 'count',      strategy_count::text     FROM stats
UNION ALL SELECT 'total_rows', total_rows::text         FROM unfiltered;
