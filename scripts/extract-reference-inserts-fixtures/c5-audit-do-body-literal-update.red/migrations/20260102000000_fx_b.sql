-- RED (review round 2, WR-01 / SFH R2-01): a LITERAL UPDATE inside a DO body rewrites the row the replay seeded (id 1), and a decline: line used to clear it with any reason text. A decline must never hide a literal write, so both are refused whatever the allowlist says. The second one assigns a PL/pgSQL variable, which reads as a column reference: a variable is not something C5 can prove harmless, so it refuses on the literal side.
DO $$
BEGIN
  UPDATE fx_ref SET label = 'v' WHERE id = 1;
END
$$;
DO $$
DECLARE
  v_label text := 'w';
BEGIN
  UPDATE fx_ref SET label = v_label WHERE id = 1;
END
$$;
