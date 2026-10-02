-- GREEN: ARRAY[...] is a literal array.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET tags = ARRAY['a', 'b'] WHERE id = 1;
