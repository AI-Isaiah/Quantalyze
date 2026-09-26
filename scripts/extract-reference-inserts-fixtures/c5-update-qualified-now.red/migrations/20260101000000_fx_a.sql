-- RED: a schema-qualified now() is whatever that schema defines, not pg_catalog's clock (review SFH-01).
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET seen_at = net.now() WHERE id = 1;
