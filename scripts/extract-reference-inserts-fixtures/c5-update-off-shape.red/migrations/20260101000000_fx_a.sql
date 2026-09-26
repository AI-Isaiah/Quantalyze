-- RED: `UPDATE t * SET` is legal PostgreSQL (descendant tables included), but
-- it is not a head shape C5 knows, so it is refused rather than replayed.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref * SET label = 'v' WHERE id = 1;
