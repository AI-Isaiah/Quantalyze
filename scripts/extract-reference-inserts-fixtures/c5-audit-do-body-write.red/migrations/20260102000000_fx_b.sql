-- RED: a DO body EXECUTES when the migration applies; its UPDATE of a replayed table is not replayed and has no line (review WR-02 item 2).
DO $$
BEGIN
  UPDATE fx_ref SET label = 'v' WHERE id = 1;
END
$$;
