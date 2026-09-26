-- RED: a lone colon outside a string is a psql variable at replay time;
-- `:'v'` interpolates whatever `-v v=…` or `\set` put there. The quoted form
-- leaves no identifier behind once masked, so the token scan admitted it.
INSERT INTO fx_ref (id, label) VALUES (1, :'v') ON CONFLICT (id) DO NOTHING;
