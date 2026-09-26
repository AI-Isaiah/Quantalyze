-- GREEN: the named remedy, the UPDATE moved out of the migration's top level.
INSERT INTO auth.users (id, aud) VALUES (1, 'fixture') ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  RAISE NOTICE 'self-verify probe';
  UPDATE auth.users SET aud = 'changed' WHERE id = 1;
END
$$;
