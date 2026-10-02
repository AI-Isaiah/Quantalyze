-- GREEN: the word inside a string literal is masked, and a QUOTED column named values is a reference.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET "values" = 'values' WHERE id IN (1);
