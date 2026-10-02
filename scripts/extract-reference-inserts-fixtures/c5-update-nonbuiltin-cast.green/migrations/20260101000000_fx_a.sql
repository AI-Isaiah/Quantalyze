-- GREEN: built-in types, bare or pg_catalog-qualified, with a typmod, an array suffix or a follow-word, are still admitted.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v'::text, uid = '00000000-0000-0000-0000-000000000000'::uuid, n = '1'::pg_catalog.int4, tags = '{}'::uuid[], x = '1'::double precision, at = '2026-01-01'::timestamptz WHERE id = 1;
