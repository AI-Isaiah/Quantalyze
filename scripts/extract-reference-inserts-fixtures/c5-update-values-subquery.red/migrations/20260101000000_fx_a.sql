-- RED: IN (VALUES (...)) is a sub-query spelled without SELECT or FROM (review WR-01).
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v' WHERE id IN (VALUES (1));
