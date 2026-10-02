-- RED (review round 2, WR-01 / SFH R2-01): TRUNCATE, MERGE and COPY … FROM of a replayed table are hard refusals at top level, and inside a DO body they are too, whatever the allowlist says. No key can prove any of them reaches only the block's own rows.
DO $$
BEGIN
  TRUNCATE fx_ref;
END
$$;
DO $$
BEGIN
  MERGE INTO fx_ref t USING fx_src s ON s.id = t.id WHEN MATCHED THEN DELETE;
END
$$;
DO $$
BEGIN
  COPY fx_ref FROM PROGRAM 'true';
END
$$;
