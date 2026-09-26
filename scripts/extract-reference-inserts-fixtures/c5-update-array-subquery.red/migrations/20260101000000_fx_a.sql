-- RED: ARRAY(...) is a sub-query constructor.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET tags = ARRAY(TABLE fx_tags) WHERE id = 1;
