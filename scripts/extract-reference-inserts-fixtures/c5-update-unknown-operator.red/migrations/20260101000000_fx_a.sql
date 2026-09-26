-- RED: an operator spelling outside the built-in set resolves to an unknown function.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v' WHERE id <=> 1;
