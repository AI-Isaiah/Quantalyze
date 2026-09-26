-- GREEN: an UNQUALIFIED now() is admitted, and a qualified COLUMN (alias.col) is a reference, not a call.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref AS r SET seen_at = now() WHERE r.id = 1;
