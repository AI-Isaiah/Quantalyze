-- GREEN: the same backfill with DO NOTHING adds rows and rewrites none; limitation 2 still skips it.
INSERT INTO fx_ref (id, label) SELECT id, label FROM fx_src ON CONFLICT (id) DO NOTHING;
