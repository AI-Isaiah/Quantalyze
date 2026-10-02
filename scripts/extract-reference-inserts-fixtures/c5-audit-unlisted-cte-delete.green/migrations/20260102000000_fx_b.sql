-- GREEN: the same CTE deleting from a table no INSERT entry fills is outside C5.
WITH d AS (DELETE FROM fx_other WHERE id = 2 RETURNING 1) SELECT count(*) FROM d;
