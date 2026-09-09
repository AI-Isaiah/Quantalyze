-- GREEN: the same seed authored at TOP LEVEL, which is the remedy the refusal
-- names. A DO body elsewhere in the file must not change the verdict.
DO $$
BEGIN
  RAISE NOTICE 'self-verify probe';
END
$$;
INSERT INTO fx_ref (id, label) VALUES (1, 'top-level') ON CONFLICT (id) DO NOTHING;
