-- GREEN: the multi-column head `SET (` directly after the target, with or without ONLY and an alias, is still admitted.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET (label, n) = ('v', 1) WHERE id = 1;
UPDATE ONLY fx_ref AS r SET (label) = ROW('w') WHERE r.id = 1;
