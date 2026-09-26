-- RED: the update: line names fx_unfilled, which no INSERT entry fills.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_unfilled SET label = 'v' WHERE id = 1;
