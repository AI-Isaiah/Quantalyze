-- GREEN: the same UPDATE at top level. A DO body elsewhere changes nothing.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  RAISE NOTICE 'self-verify probe';
END
$$;
UPDATE fx_ref SET label = 'top-level' WHERE id = 1;
