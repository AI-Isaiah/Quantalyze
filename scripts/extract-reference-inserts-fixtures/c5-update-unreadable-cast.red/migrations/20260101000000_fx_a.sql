-- RED: a cast whose type carries a non-numeric typmod is not a type C5 can read.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v'::text(label) WHERE id = 1;
