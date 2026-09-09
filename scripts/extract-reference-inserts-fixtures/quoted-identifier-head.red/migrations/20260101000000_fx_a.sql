-- RED: the quoted spelling names a DIFFERENT table, so nothing is measured and
-- the pinned count must not be satisfied by a head regex that matches too widely.
INSERT INTO "public"."fx_ref_other" (id, label) VALUES (1, 'ref_a') ON CONFLICT (id) DO NOTHING;
