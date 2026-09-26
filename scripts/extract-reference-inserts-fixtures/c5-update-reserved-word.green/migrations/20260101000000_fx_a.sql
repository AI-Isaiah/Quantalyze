-- GREEN: CASE WHEN THEN ELSE END, NULL, TRUE and FALSE are admitted reserved words. (DEFAULT was, until 164.9.2 review round 2, IN-05: it is refused by c5-update-default now.)
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = CASE WHEN id = 1 THEN 'a' ELSE 'b' END, flag = TRUE, note = NULL WHERE id = 1;
