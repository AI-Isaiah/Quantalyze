-- GREEN: the DO-body write is accounted for by a decline: line, and the UPDATE inside a CREATE FUNCTION body (defined, never executed here) is NOT counted, so decline:1 matches.
DO $$
BEGIN
  UPDATE fx_ref SET label = 'v' WHERE id = 1;
END
$$;
CREATE FUNCTION fx_fn() RETURNS void LANGUAGE sql AS $f$
  UPDATE fx_ref SET label = 'w' WHERE id = 2;
$f$;
