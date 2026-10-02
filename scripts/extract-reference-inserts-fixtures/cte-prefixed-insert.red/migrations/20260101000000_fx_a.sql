-- RED: a CTE can read existing rows, so this is not a judgement the extractor
-- can make. It must be refused BY NAME, never skipped in silence.
WITH src AS (SELECT 1 AS id) INSERT INTO fx_ref (id, label) VALUES (1, 'ref_a');
