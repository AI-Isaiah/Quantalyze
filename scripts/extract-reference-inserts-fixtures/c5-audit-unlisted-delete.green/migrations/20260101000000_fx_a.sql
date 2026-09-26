-- GREEN: a DELETE on a table no INSERT entry fills is outside C5.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
DELETE FROM fx_other WHERE id = 2;
