-- GREEN: the same corpus with its decline: line.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = s.label FROM fx_src s WHERE fx_ref.id = s.id;
