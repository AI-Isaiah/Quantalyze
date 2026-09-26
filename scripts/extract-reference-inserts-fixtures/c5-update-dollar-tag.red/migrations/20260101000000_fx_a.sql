-- RED: a dollar-quoted literal in the SET would put a body into the replay.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = $q$quoted$q$ WHERE id = 1;
