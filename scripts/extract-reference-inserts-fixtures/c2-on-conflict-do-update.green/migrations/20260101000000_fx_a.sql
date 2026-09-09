-- GREEN: the idempotent seed idiom the allowlist's C4 describes.
INSERT INTO fx_ref (id, label) VALUES (1, 'ref_a') ON CONFLICT (id) DO NOTHING;
