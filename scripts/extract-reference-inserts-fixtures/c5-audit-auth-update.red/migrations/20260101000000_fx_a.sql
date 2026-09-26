-- RED: a top-level literal UPDATE of auth.users, which an INSERT entry fills.
-- auth.users survives the restore, and parse refuses a C5 line on it, so no
-- line can account for this statement.
INSERT INTO auth.users (id, aud) VALUES (1, 'fixture') ON CONFLICT (id) DO NOTHING;
UPDATE auth.users SET aud = 'changed' WHERE id = 1;
