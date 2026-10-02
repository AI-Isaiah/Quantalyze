-- GREEN: the cast the replayed corpus really carries (::uuid, four times in the teaser INSERTs) and other built-ins, bare or pg_catalog-qualified, are still admitted.
INSERT INTO fx_ref (id, uid, label, n)
VALUES (1, '00000000-0000-0000-0000-000000000000'::uuid, 'v'::text, '1'::pg_catalog.int4)
ON CONFLICT (id) DO NOTHING;
