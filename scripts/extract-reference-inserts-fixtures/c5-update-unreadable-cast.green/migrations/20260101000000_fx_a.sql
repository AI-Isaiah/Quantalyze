-- GREEN: qualified, multi-word, typmod'd and array casts are admitted. The qualified one is pg_catalog.text since 164.9.2 review round 2 (IN-05): a user type such as public.fx_kind is refused by c5-update-nonbuiltin-cast now.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v'::character varying(20), n = '1'::numeric(10, 2), tags = '{}'::text[], kind = 'k'::pg_catalog.text WHERE id = 1;
