-- GREEN: now() is admitted, and `AND (` groups a boolean, it is not a call.
-- 164.9.2 review WR-03 / SFH-03: so are the parentheses that are not function
-- lookups — ANY/ALL/SOME over a literal array, ROW, the COALESCE / NULLIF /
-- GREATEST / LEAST constructs, the multi-column SET (a, b) = (...) head, a
-- parenthesised WHERE / THEN — and a `timestamp with time zone` cast.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v', seen_at = now() WHERE id = 1 AND (label = 'a' OR label = 'b');
UPDATE fx_ref SET label = 'v' WHERE id = ANY(ARRAY[1, 2]) AND id <> ALL('{3}') AND id = SOME(ARRAY[1]);
UPDATE fx_ref SET (label, n) = ('v', 1) WHERE (id, n) = ROW(1, 2);
UPDATE fx_ref SET label = coalesce(label, 'v'), n = nullif(n, 0), m = greatest(n, 1) + least(n, 2) WHERE (id = 1);
UPDATE fx_ref SET label = CASE WHEN (id = 1) THEN ('a') ELSE ('b') END, seen_at = '2026-01-01'::timestamp with time zone WHERE id = 1;
