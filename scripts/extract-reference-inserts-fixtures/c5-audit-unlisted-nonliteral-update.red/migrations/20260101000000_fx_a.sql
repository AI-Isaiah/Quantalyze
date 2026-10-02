-- RED: a top-level joined UPDATE of a replayed table with no C5 line. It is
-- refused by name, never skipped as the INSERT side skips an unlisted backfill.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = s.label FROM fx_src s WHERE fx_ref.id = s.id;
