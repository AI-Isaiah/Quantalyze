-- GREEN: ONLY and an AS alias are within the shape.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE ONLY fx_ref AS r SET label = 'v' WHERE r.id = 1;
