-- RED: a top-level literal UPDATE of a replayed table with no C5 line.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v' WHERE id = 1;
