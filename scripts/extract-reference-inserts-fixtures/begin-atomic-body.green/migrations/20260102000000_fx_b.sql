-- GREEN: the same function with a dollar-quoted body is defined, never run, and C5 counts nothing in it. The words BEGIN ATOMIC inside a comment or a string are not a body.
-- BEGIN ATOMIC
CREATE FUNCTION fx_fn() RETURNS text LANGUAGE sql AS $f$
  UPDATE fx_ref SET label = 'v' WHERE id = 1;
  UPDATE fx_ref SET label = 'w' WHERE id = 1;
  SELECT 'BEGIN ATOMIC';
$f$;
