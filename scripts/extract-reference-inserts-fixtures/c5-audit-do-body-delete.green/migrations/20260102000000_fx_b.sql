-- GREEN: the self-verification idiom the corpus really uses (20260602183000_b5b_api_key_delete_atomicity.sql). The block declares a key as gen_random_uuid(), never reassigns it, writes a probe row under it and deletes that row by it, so the DELETE can reach only rows the block itself wrote. That is PROVEN, not asserted, so a decline: line may account for it. The column may sit on either side of the `=`.
DO $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO fx_ref (id, label) VALUES (v_id, 'probe');
  DELETE FROM fx_ref WHERE id = v_id;
  DELETE FROM ONLY public.fx_ref WHERE v_id = fx_ref.id;
END
$$;
