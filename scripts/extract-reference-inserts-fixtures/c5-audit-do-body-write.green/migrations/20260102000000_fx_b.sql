-- GREEN: the NON-literal DO-body write is accounted for by a decline: line, and the UPDATE inside a CREATE FUNCTION body (defined, never executed here) is NOT counted, so decline:1 matches. Round 2 (review WR-01): it targets id 2, a row the replay did NOT write; until round 2 this leg declined a LITERAL write of id 1, the seeded row, which is exactly the hidden replayable effect a decline must never cover.
DO $$
BEGIN
  UPDATE fx_ref SET label = lower(label) WHERE id = 2;
END
$$;
CREATE FUNCTION fx_fn() RETURNS void LANGUAGE sql AS $f$
  UPDATE fx_ref SET label = 'w' WHERE id = 2;
$f$;
