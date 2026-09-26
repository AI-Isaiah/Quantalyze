-- GREEN: the same UPDATE with a plain literal.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'plain' WHERE id = 1;
