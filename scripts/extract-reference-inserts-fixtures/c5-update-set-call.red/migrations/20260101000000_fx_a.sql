-- RED: SET is an UNRESERVED keyword, so `set(` is a legal function call wherever a call may stand; only the multi-column head `SET (` directly after the target is grammar (review round 2, CR-01).
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = set('x') WHERE id = 1;
UPDATE fx_ref SET label = 'v' WHERE id = 1 AND set(2) IS NOT NULL;
