-- RED (review round 2, WR-02): ONE rule for an upsert, at top level and in a DO body. Round 1 refused the top-level one with no line able to account for it, while a decline: line cleared its DO-body twin. Both below rewrite a row nothing proves the replay did not write, so both are hard refusals whatever the allowlist says: the idiomatic backfill at top level, and a literal-keyed upsert of the seeded row in a DO body.
INSERT INTO fx_ref (id, label) SELECT id, 'x' FROM fx_other ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;
DO $$
BEGIN
  INSERT INTO fx_ref (id, label) VALUES (1, 'x') ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;
END
$$;
