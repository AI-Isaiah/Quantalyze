-- GREEN: a backslash INSIDE a string literal is masked and admitted.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'a\b' WHERE id = 1;
