-- GREEN: quoted identifiers NOT followed by ( are column references.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET "label" = 'v' WHERE "id" = 1;
