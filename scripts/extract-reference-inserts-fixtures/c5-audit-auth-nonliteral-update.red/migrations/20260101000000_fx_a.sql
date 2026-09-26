-- RED: a top-level joined UPDATE of auth.users, which an INSERT entry fills.
INSERT INTO auth.users (id, aud) VALUES (1, 'fixture') ON CONFLICT (id) DO NOTHING;
UPDATE auth.users SET aud = s.aud FROM fx_src s WHERE auth.users.id = s.id;
