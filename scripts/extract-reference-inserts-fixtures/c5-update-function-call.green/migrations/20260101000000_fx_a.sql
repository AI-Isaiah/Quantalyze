-- GREEN: now() is admitted, and `AND (` groups a boolean, it is not a call.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v', seen_at = now() WHERE id = 1 AND (label = 'a' OR label = 'b');
