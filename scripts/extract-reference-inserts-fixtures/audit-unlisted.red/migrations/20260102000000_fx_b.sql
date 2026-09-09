-- RED: a later migration seeds the SAME allowlisted table with no allowlist
-- line of its own — the drift a static list cannot see about itself.
INSERT INTO fx_ref (id, label) VALUES (2, 'unlisted') ON CONFLICT (id) DO NOTHING;
