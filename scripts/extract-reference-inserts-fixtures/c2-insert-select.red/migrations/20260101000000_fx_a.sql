-- RED: a backfill of existing data. On an empty table it inserts nothing.
INSERT INTO fx_ref (id, label) SELECT id, label FROM fx_source;
