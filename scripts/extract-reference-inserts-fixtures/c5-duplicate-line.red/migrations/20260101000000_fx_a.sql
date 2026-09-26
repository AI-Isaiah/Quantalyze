-- RED: two update: lines for one (file, table) double-pin one count.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v' WHERE id = 1;
