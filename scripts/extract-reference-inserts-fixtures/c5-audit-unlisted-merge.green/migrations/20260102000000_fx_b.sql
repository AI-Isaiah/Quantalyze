-- GREEN: a MERGE INTO a table no INSERT entry fills is outside C5.
MERGE INTO fx_other t USING fx_src s ON t.id = s.id WHEN MATCHED THEN UPDATE SET label = s.label;
