-- RED: a positional parameter outside a string cannot be bound by the replay.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = $1 WHERE id = 1;
