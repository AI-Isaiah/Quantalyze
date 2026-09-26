-- RED: a decline: line over a LITERAL UPDATE would hide a replayable effect.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v' WHERE id = 1;
