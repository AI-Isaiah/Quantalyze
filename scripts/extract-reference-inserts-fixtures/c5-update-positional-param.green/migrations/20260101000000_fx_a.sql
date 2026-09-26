-- GREEN: the same dollar sign INSIDE a string literal is data, masked away.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'costs $1' WHERE id = 1;
