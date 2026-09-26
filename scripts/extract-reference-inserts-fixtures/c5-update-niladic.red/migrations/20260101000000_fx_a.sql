-- RED: current_user takes no parentheses and replays the RESTORE session's role (review WR-01).
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = current_user WHERE id = 1;
