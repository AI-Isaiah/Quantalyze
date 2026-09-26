-- RED (review round 2, WR-01 / SFH R2-01): a top-level DELETE of a replayed table is a hard refusal, and a DO body used to launder it into a decline:. Each DELETE below is refused whatever the allowlist says: the first reaches the seeded row directly; the second is keyed by a gen_random_uuid() variable the block then REASSIGNS; the third by one it declares twice (a nested block shadows it). None is keyed by a fresh key C5 can prove.
DO $$
BEGIN
  DELETE FROM fx_ref WHERE id = 1;
END
$$;
DO $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  v_id := '00000000-0000-0000-0000-000000000001';
  DELETE FROM fx_ref WHERE id = v_id;
END
$$;
DO $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  DECLARE
    v_id uuid := '00000000-0000-0000-0000-000000000001';
  BEGIN
    DELETE FROM fx_ref WHERE id = v_id;
  END;
END
$$;
