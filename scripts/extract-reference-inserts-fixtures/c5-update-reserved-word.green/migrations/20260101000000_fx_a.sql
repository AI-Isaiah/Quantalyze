-- GREEN: CASE WHEN THEN ELSE END, NULL, TRUE, FALSE and DEFAULT are admitted reserved words.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = CASE WHEN id = 1 THEN 'a' ELSE 'b' END, flag = TRUE, note = NULL, kind = DEFAULT WHERE id = 1;
