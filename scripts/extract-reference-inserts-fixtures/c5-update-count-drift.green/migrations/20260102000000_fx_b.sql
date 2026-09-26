-- GREEN (ORDER leg): the later file inserts into fx_ref2. Its INSERT must be
-- emitted AFTER the earlier file's UPDATE whatever the allowlist line order.
INSERT INTO fx_ref2 (id, label) VALUES (1, 'later') ON CONFLICT (id) DO NOTHING;
