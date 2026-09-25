-- GREEN: comparison, arithmetic and concatenation operators are admitted; =-1 is PostgreSQL's = then -1.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = label || 'v', n = n + 1 WHERE id >= 1 AND id <> 2 AND id =-1;
