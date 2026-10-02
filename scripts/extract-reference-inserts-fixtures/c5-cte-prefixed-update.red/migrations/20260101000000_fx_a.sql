-- RED: a CTE-prefixed UPDATE does not start with UPDATE; refused by name.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
WITH s AS (SELECT 1) UPDATE fx_ref SET label = 'v' WHERE id = 1;
