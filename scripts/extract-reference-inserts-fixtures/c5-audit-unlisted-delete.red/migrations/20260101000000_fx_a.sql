-- RED: a top-level DELETE on a table the replay fills. C5 replays UPDATE only.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
DELETE FROM fx_ref WHERE id = 2;
