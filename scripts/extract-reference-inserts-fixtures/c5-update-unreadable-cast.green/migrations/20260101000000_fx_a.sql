-- GREEN: qualified, multi-word, typmod'd and array casts are admitted.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v'::character varying(20), n = '1'::numeric(10, 2), tags = '{}'::text[], kind = 'k'::public.fx_kind WHERE id = 1;
