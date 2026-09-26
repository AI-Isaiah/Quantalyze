-- RED: a backslash outside a string is a psql meta-command at replay time
-- (`\\` here, psql's separator; `\!` would run a shell). No identifier follows
-- it, so the token scan alone admitted it until the character allowlist.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed' \\) ON CONFLICT (id) DO NOTHING;
