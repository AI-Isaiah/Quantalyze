-- GREEN: one update: and one decline: line for the same pair is legal, because
-- a file can hold a literal and a joined UPDATE on one table. Only the literal
-- one is emitted.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v' WHERE id = 1;
UPDATE fx_ref SET label = s.label FROM fx_src s WHERE fx_ref.id = s.id;
