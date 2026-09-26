-- GREEN: a QUOTED "user" is a column, and CURRENT_TIMESTAMP is the statement clock, admitted as now() is.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET "user" = 'v', seen_at = CURRENT_TIMESTAMP WHERE id = 1;
