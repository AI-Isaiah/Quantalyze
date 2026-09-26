-- RED: a backslash outside a string is a psql meta-command at replay time.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v' WHERE id = 1 \gexec;
