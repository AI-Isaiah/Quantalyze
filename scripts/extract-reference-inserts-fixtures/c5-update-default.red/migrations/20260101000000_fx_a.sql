-- RED (review round 2, IN-05 / SFH R2-05): SET col = DEFAULT evaluates the column's default in the RESTORE session, and a default can read session state, the concern that got the niladic session functions refused.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = DEFAULT WHERE id = 1;
