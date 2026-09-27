-- RED: an unlisted INSERT ... ON CONFLICT DO UPDATE rewrites an EXISTING replayed row; limitation 2 skipped it as a backfill (review WR-02 item 1).
INSERT INTO fx_ref (id, label) SELECT id, label FROM fx_src ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;
