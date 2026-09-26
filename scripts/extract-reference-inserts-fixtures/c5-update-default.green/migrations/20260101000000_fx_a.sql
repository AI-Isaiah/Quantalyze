-- GREEN: the word inside a string, and a QUOTED column named default, are not the DEFAULT keyword.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'default', "default" = 1 WHERE id = 1;
