-- RED: a data-modifying CTE deletes from a replayed table without starting with DELETE (review IN-04).
WITH d AS (DELETE FROM fx_ref WHERE id = 2 RETURNING 1) SELECT count(*) FROM d;
