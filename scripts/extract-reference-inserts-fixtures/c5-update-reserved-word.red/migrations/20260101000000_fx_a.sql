-- RED: a reserved word outside the admitted set is syntax C5 has not been taught to read.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = label COLLATE "C" WHERE id = 1;
