-- RED: a MERGE INTO a replayed table can update, insert or delete its rows (review IN-04).
MERGE INTO fx_ref t USING fx_src s ON t.id = s.id WHEN MATCHED THEN UPDATE SET label = s.label;
