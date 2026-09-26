-- GREEN (review round 2, WR-02): the same rule admits both spellings when the conflict column takes a key the statement or its block minted with gen_random_uuid(), so the DO UPDATE arm can reach only a row it wrote itself. The top-level one takes the call; the DO-body one (the cleanup self-test idiom) a variable declared once and never reassigned. decline:2 accounts for both.
INSERT INTO fx_ref (id, label) VALUES (gen_random_uuid(), 'x') ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;
DO $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.fx_ref (id, label) VALUES (v_id, 'x') ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;
END
$$;
