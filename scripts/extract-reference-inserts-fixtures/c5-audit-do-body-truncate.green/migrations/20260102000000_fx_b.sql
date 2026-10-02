-- GREEN: the same three writes on a table no INSERT entry fills are outside C5.
DO $$
BEGIN
  TRUNCATE fx_other;
  MERGE INTO fx_other t USING fx_src s ON s.id = t.id WHEN MATCHED THEN DELETE;
  COPY fx_other FROM PROGRAM 'true';
END
$$;
