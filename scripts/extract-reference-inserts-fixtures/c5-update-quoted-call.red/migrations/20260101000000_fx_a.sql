-- RED: a QUOTED function name is still a call; maskSql keeps quoted identifiers, so the old call regex never saw it (review CR-01).
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = "pg_notify"('c', 'p') WHERE id = 1;
