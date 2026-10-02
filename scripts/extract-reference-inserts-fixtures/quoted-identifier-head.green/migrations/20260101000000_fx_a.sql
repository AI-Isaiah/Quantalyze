-- GREEN: baseline.sql's house spelling. It must be CLASSIFIED, not skipped.
INSERT INTO "public"."fx_ref" (id, label) VALUES (1, 'ref_a') ON CONFLICT (id) DO NOTHING;
