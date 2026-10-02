-- RED: a DO body EXECUTES when the migration applies; its NON-literal UPDATE of a replayed table is not replayed and has no line (review WR-02 item 2). Round 2 (WR-01): the write targets id 2, a row the replay did not write; a LITERAL DO-body UPDATE is a hard refusal, pinned by c5-audit-do-body-literal-update.
DO $$
BEGIN
  UPDATE fx_ref SET label = lower(label) WHERE id = 2;
END
$$;
