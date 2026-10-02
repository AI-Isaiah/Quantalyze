-- RED: the update: line sits over an UPDATE ... FROM, which reads rows the
-- restore has just dropped. It is not literal, so C5 must refuse it by name.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = s.label FROM fx_src s WHERE fx_ref.id = s.id;
