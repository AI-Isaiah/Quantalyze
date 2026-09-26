-- GREEN: a literal UPDATE with an IN list is replayed. So are the two
-- IS [NOT] DISTINCT FROM idioms (164.9.2 review WR-03 / SFH-03): their FROM is
-- a comparison operator, not a join, and refusing it sent a replayable UPDATE
-- to a decline: line, the outcome D-02 forbids.
INSERT INTO fx_ref (id, label) VALUES (1, 'seed') ON CONFLICT (id) DO NOTHING;
UPDATE fx_ref SET label = 'v' WHERE id IN (1);
UPDATE fx_ref SET label = 'v' WHERE label IS DISTINCT FROM 'v' AND id = 1;
UPDATE fx_ref SET label = 'w' WHERE label IS NOT DISTINCT FROM 'v';
-- Review round 2, WR-04: a PARENTHESISED right operand. Blanking the phrase to
-- spaces made `label (` adjacent and read it as the call `label(`.
UPDATE fx_ref SET label = 'v' WHERE label IS DISTINCT FROM ('v');
UPDATE fx_ref SET label = 'w' WHERE (id, label) IS NOT DISTINCT FROM (1, 'v');
