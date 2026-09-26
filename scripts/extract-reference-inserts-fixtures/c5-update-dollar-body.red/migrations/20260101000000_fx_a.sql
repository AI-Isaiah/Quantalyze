-- RED: the only UPDATE of fx_ref sits inside a DO body (C1). It is not the
-- body's first statement, so it surfaces as its own span.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  RAISE NOTICE 'self-verify probe';
  UPDATE fx_ref SET label = 'body' WHERE id = 1;
END
$$;
