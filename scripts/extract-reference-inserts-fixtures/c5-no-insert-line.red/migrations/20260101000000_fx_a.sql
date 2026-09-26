-- RED: the allowlist carries only a C5 line, so nothing the count floor
-- can measure is replayed.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v' WHERE id = 1;
