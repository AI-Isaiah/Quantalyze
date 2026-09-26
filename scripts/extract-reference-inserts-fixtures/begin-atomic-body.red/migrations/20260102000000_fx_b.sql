-- RED (review round 2, IN-02 / SFH R2-03): a SQL-standard BEGIN ATOMIC body is not dollar-quoted, so the lexer splits it at every inner `;`. The first UPDATE hides inside the CREATE span and the second lexes as a TOP-LEVEL statement, which the audit then advised replaying with an update: line: an UPDATE the migration only DEFINED, never ran.
CREATE FUNCTION fx_fn() RETURNS void LANGUAGE sql
BEGIN ATOMIC
  UPDATE fx_ref SET label = 'v' WHERE id = 1;
  UPDATE fx_ref SET label = 'w' WHERE id = 1;
END;
